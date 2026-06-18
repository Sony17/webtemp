# Invoke the ONDC Delivery-flow /select via the local BAP, which signs the
# request (Authorization + Digest) and POSTs it to the Workbench seller's
# /select. Run `npm run dev` first so http://localhost:3000 is up.
#
# Usage:
#   pwsh scripts/ondc/samples/select-delivery.ps1
#   pwsh scripts/ondc/samples/select-delivery.ps1 -BaseUrl https://www.openidea.co.in
#
# This posts the BAP's ERGONOMIC body (see src/app/api/ondc/select/route.ts),
# NOT the raw Beckn payload in select-delivery.json — the route builds the
# context + order and signs it. To inspect the exact wire payload that this
# produces, see select-delivery.json (same provider/item/location/fulfillment).

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$BppId   = "staging-automation.ondc.org",
  [string]$BppUri  = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller",
  [string]$ProviderId = "P1",
  [string]$ItemId     = "I1",
  [string]$LocationId = "L1",
  [int]$Quantity      = 2,
  [string]$Gps        = "12.9716,77.5946",
  [string]$AreaCode   = "560001"
)

# Delivery flow uses a FRESH transaction id (distinct from the discovery search).
$TransactionId = [guid]::NewGuid().ToString()

$body = @{
  transactionId = $TransactionId
  bppId         = $BppId
  bppUri        = $BppUri
  providerId    = $ProviderId
  items         = @(
    @{ id = $ItemId; quantity = $Quantity; locationId = $LocationId }
  )
  fulfillment   = @{ gps = $Gps; areaCode = $AreaCode }
} | ConvertTo-Json -Depth 6

Write-Host "POST $BaseUrl/api/ondc/select  (transaction_id=$TransactionId)" -ForegroundColor Cyan

$resp = Invoke-WebRequest -Uri "$BaseUrl/api/ondc/select" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body `
  -SkipHttpErrorCheck

Write-Host "HTTP $($resp.StatusCode)" -ForegroundColor Yellow
$resp.Content
