# Drive the full ONDC Delivery flow through the local BAP with ONE shared
# transaction id: select -> init -> confirm. The CONFIRM order is an exact echo
# of the order the seller firmed up in on_init (quote, payment.settlement_details,
# tags), with only the buyer's confirm-specific fields added (order id/state/
# timestamps + payment collected_by/type/status/params). Echoing on_init is what
# lets the seller reconcile and actually PLACE the order, so it emits on_confirm.
# Run `npm run dev` first so http://localhost:3000 is up, AND have an active flow
# session in the ONDC workbench UI (otherwise select/init NACK with 428).
#
# Usage:
#   pwsh scripts/ondc/samples/confirm-flow.ps1

param(
  [string]$BaseUrl    = "http://localhost:3000",
  [string]$BppId      = "staging-automation.ondc.org",
  [string]$BppUri     = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller",
  [string]$ProviderId = "P1",
  [string]$ItemId     = "I1",
  [string]$LocationId = "L1",
  [int]$Quantity      = 2,
  [string]$Gps        = "12.9716,77.5946",
  [string]$AreaCode   = "560001"
)

$ErrorActionPreference = "Stop"

# ONE transaction id reused across select/init/confirm — the spine of the order.
$Txn = [guid]::NewGuid().ToString()
Write-Host "transaction_id = $Txn" -ForegroundColor Green

# Current UTC in ONDC's millisecond-Z format. The order/billing created_at must be
# WITHIN this transaction's timeline — a past-dated order (e.g. copied from an old
# flow) makes the seller-sim silently fail to generate on_confirm even though the
# sync ACK passes. So stamp it fresh per run.
#
# InvariantCulture is REQUIRED: in a .NET format string ':' is the culture's TIME
# SEPARATOR placeholder, not a literal. On a machine whose culture uses '.' for it,
# "HH:mm:ss" renders as "19.56.04" and ONDC NACKs the malformed date-time. Invariant
# culture pins the separator to ':'.
$NowIso = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", [Globalization.CultureInfo]::InvariantCulture)

# Windows PowerShell 5.1 has no -SkipHttpErrorCheck, so a non-2xx status throws.
# Catch it and read the error response body so NACKs (422) are visible, not fatal.
function Invoke-Step {
  param([string]$Name, [string]$Path, $Body)
  $json = $Body | ConvertTo-Json -Depth 30
  Write-Host "`n=== $Name  ->  POST $Path ===" -ForegroundColor Cyan
  try {
    $resp = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method Post `
      -ContentType "application/json" -Body $json -UseBasicParsing
    Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Yellow
    $resp.Content
  } catch {
    $r = $_.Exception.Response
    if ($r) {
      $code = [int]$r.StatusCode
      Write-Host "HTTP $code" -ForegroundColor Red
      $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
      $reader.ReadToEnd()
    } else {
      Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}

# 1) SELECT — commit to provider + items to get a firm quote (on_select, async).
$select = @{
  transactionId = $Txn
  bppId         = $BppId
  bppUri        = $BppUri
  providerId    = $ProviderId
  items         = @(@{ id = $ItemId; quantity = $Quantity; locationId = $LocationId })
  fulfillment   = @{ type = "Delivery"; gps = $Gps; areaCode = $AreaCode }
}
Invoke-Step -Name "select" -Path "/api/ondc/select" -Body $select

# 2) INIT — add billing + confirmed fulfillment; BPP firms the order (on_init).
$init = @{
  transactionId = $Txn
  bppId         = $BppId
  bppUri        = $BppUri
  providerId    = $ProviderId
  items         = @(@{ id = $ItemId; quantity = $Quantity; locationId = $LocationId })
  billing       = @{
    name = "ONDC Buyer"; phone = "9886098860"; email = "buyer@example.com"
    address = "House 101"; building = "Building A"; locality = "MG Road"
    city = "Bengaluru"; state = "Karnataka"; country = "IND"; areaCode = $AreaCode
  }
  fulfillment   = @{ type = "Delivery"; gps = $Gps; areaCode = $AreaCode }
}
Invoke-Step -Name "init" -Path "/api/ondc/init" -Body $init

# Give the workbench a moment to place its on_init callback before we confirm —
# confirm is only valid once on_init is in the transaction history. (Running them
# back-to-back can NACK "on_init not found".)
Write-Host "`n... waiting 10s for on_init ..." -ForegroundColor DarkGray
Start-Sleep -Seconds 10

# 3) CONFIRM — place the order. The order below is an EXACT echo of the on_init
#    order (quote 400.00 / "Plain Atta" / 3-line breakup, payment settlement_details,
#    bpp_terms tags) so the seller can reconcile and place it. Only the buyer's
#    confirm fields are added: order id/state/timestamps + payment collected_by/
#    type/status/params.
$confirm = @{
  transactionId = $Txn
  bppId         = $BppId
  bppUri        = $BppUri
  order = @{
    id         = "ORD-001"
    state      = "Created"
    created_at = $NowIso
    updated_at = $NowIso

    provider = @{ id = $ProviderId; locations = @(@{ id = $LocationId }) }

    items = @(
      @{ id = $ItemId; quantity = @{ count = $Quantity }; location_id = $LocationId; fulfillment_id = "F1" }
    )

    billing = @{
      name = "ONDC Buyer"; phone = "9886098860"; email = "buyer@example.com"
      address = @{ name = "House 101"; building = "Building A"; locality = "MG Road"; city = "Bengaluru"; state = "Karnataka"; country = "IND"; area_code = $AreaCode }
      created_at = $NowIso; updated_at = $NowIso
    }

    fulfillments = @(
      @{
        id = "F1"; type = "Delivery"
        end = @{
          location = @{
            gps = $Gps
            address = @{ name = "House 101"; building = "Building A"; locality = "MG Road"; city = "Bengaluru"; state = "Karnataka"; country = "IND"; area_code = $AreaCode }
          }
          contact = @{ phone = "9886098860" }
        }
        tracking = $true
      }
    )

    # Echoed verbatim from on_init.
    quote = @{
      price = @{ currency = "INR"; value = "400.00" }
      ttl   = "P1D"
      breakup = @(
        @{
          "@ondc/org/item_id" = $ItemId
          "@ondc/org/item_quantity" = @{ count = $Quantity }
          title = "Plain Atta"
          "@ondc/org/title_type" = "item"
          price = @{ currency = "INR"; value = "400.00" }
          item  = @{ price = @{ currency = "INR"; value = "200.00" } }
        },
        @{
          "@ondc/org/item_id" = "F1"
          title = "Delivery charges"
          "@ondc/org/title_type" = "delivery"
          price = @{ currency = "INR"; value = "00.00" }
        },
        @{
          "@ondc/org/item_id" = "F1"
          title = "Convenience Fee"
          "@ondc/org/title_type" = "misc"
          price = @{ currency = "INR"; value = "00.00" }
        }
      )
    }

    payment = @{
      # --- echoed from on_init (seller's settlement bank + finder fee) ---
      "@ondc/org/buyer_app_finder_fee_type"   = "percent"
      "@ondc/org/buyer_app_finder_fee_amount" = "3"
      "@ondc/org/settlement_details" = @(
        @{
          settlement_counterparty    = "seller-app"
          settlement_phase           = "sale-amount"
          settlement_type            = "neft"
          beneficiary_name           = "xxxx"
          settlement_bank_account_no = "XXXX"
          settlement_ifsc_code       = "XXXX"
          bank_name                  = "XXXX"
          branch_name                = "XXXX"
        }
      )
      # --- buyer-supplied confirm fields ---
      collected_by = "BAP"
      type         = "ON-ORDER"
      status       = "PAID"
      params       = @{ amount = "400.00"; currency = "INR"; transaction_id = "PG-TXN-001" }
      # Settlement TERMS the buyer commits to (reference confirm.json has these).
      "@ondc/org/settlement_basis"    = "delivery"
      "@ondc/org/settlement_window"   = "P1D"
      "@ondc/org/withholding_amount"  = "0.00"
    }

    # tags = on_init's bpp_terms (echoed) PLUS the buyer's bap_terms. The seller
    # needs the buyer to ACCEPT its terms (accept_bpp_terms=Y) to PLACE the order
    # and emit on_confirm — without bap_terms it ACKs but never confirms.
    tags = @(
      @{
        code = "bpp_terms"
        list = @(
          @{ code = "np_type"; value = "MSN" }
          @{ code = "tax_number"; value = "00ABCCH7409R1ZZ" }
          @{ code = "provider_tax_number"; value = "ABCDE1234F" }
        )
      },
      @{
        code = "bap_terms"
        list = @(
          @{ code = "accept_bpp_terms"; value = "Y" }
          @{ code = "tax_number"; value = "29AAACU1234F1ZV" }
          @{ code = "static_terms"; value = "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf" }
        )
      }
    )
  }
}
Invoke-Step -Name "confirm" -Path "/api/ondc/confirm" -Body $confirm

Write-Host "`nDone. transaction_id reused across all three steps: $Txn" -ForegroundColor Green
Write-Host "If confirm ACKs, watch the deployed openidea.co.in logs for POST /ondc/on_confirm." -ForegroundColor Green
