$BASE = "https://openidea.co.in/api/ondc"
$BPP_ID = "staging-automation.ondc.org"
$BPP_URI = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller"
$TXN = [guid]::NewGuid().ToString()

function Send-Ondc($path, $body) {
  try {
    Invoke-RestMethod `
      -Uri "$BASE/$path" `
      -Method Post `
      -ContentType "application/json" `
      -Body ($body | ConvertTo-Json -Depth 50)
  } catch {
    Write-Host "=== HTTP $($_.Exception.Response.StatusCode.value__) ==="
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.ReadToEnd()
  }
}

Write-Host "TXN=$TXN"

# 1. select
$select = Send-Ondc "select" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
  providerId = "P1"
  items = @(
    @{
      id = "I1"
      quantity = 2
      locationId = "L1"
    }
  )
  fulfillment = @{
    type = "Delivery"
    gps = "12.9716,77.5946"
    areaCode = "560001"
  }
}
$select

# 3. init
$init = Send-Ondc "init" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
  providerId = "P1"
  items = @(
    @{
      id = "I1"
      quantity = 2
      locationId = "L1"
    }
  )
  billing = @{
    name = "Asha K"
    phone = "9876543210"
    email = "asha@example.com"
    building = "Flat 4B"
    locality = "MG Road"
    city = "Bengaluru"
    state = "Karnataka"
    country = "IND"
    areaCode = "560001"
  }
  fulfillment = @{
    gps = "12.9716,77.5946"
    areaCode = "560001"
  }
}
$init

# 5. confirm
$confirm = Send-Ondc "confirm" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
}
$confirm
$ORDER_ID = $confirm.orderId
Write-Host "ORDER_ID=$ORDER_ID"

# Wait for 6. on_confirm and 7-12. on_status unsolicited callbacks
Write-Host ">>> Wait for on_confirm + on_status unsolicited (6 steps), then press enter"
pause

# 13. issue(open) — NO domain/coreVersion overrides; defaults to ONDC:RET10/1.2.5
$openIssue = Send-Ondc "issue" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
  complainantAction = "OPEN"
  category = "ITEM"
  subCategory = "ITM02"
  shortDesc = "Item quality issue"
  longDesc = "Buyer received an item with quality issue and requests resolution."
  complainant = @{
    name = "Asha K"
    phone = "9876543210"
    email = "asha@example.com"
  }
  orderId = $ORDER_ID
  orderState = "Completed"
  providerId = "P1"
  items = @(
    @{
      id = "I1"
      quantity = 2
    }
  )
  fulfillments = @(
    @{
      id = "F1"
      state = "Order-delivered"
    }
  )
}
$openIssue
$ISSUE_ID = $openIssue.issueId
Write-Host "ISSUE_ID=$ISSUE_ID"

# Wait for 14. on_issue(processing) and 15. on_issue(resolution)
Write-Host ">>> Wait for on_issue(processing) + on_issue(resolution), then press enter"
pause

# 16. issue(resolution_accept) — NO domain/coreVersion overrides
$accept = Send-Ondc "issue" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
  issueId = $ISSUE_ID
  complainantAction = "RESOLUTION_ACCEPT"
  actionDesc = "Buyer accepts the proposed resolution."
}
$accept

# Wait for 17. on_issue(resolved)
Write-Host ">>> Wait for on_issue(resolved), then press enter"
pause

# 18. issue(close) — NO domain/coreVersion overrides
$close = Send-Ondc "issue" @{
  transactionId = $TXN
  bppId = $BPP_ID
  bppUri = $BPP_URI
  issueId = $ISSUE_ID
  complainantAction = "CLOSE"
  actionDesc = "Buyer closes the issue."
}
$close
