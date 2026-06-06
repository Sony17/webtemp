# ONDC Gap Analysis

Last Updated: 2026-06-06

## Overview

This document tracks the implementation status of the ONDC Buyer App (BAP), identifies gaps against the original roadmap, and defines the current priorities for development and testing.

---

# Fully Implemented 

## ONDC Transaction Lifecycle

* Search / On_Search
* Select / On_Select
* Init / On_Init
* Confirm / On_Confirm
* Status / On_Status
* Track / On_Track
* Cancel / On_Cancel
* Update / On_Update
* Support / On_Support
* Rating / On_Rating

## Core Infrastructure

* auth.ts
* context.ts
* client.ts
* store.ts
* registry.ts

## Security

* Request Signing
* Callback Signature Verification
* Strict unique_key_id Matching
* Shared Registry Resolver
* signer == bpp_id Validation

## Persistence

* Catalog Persistence
* Quote Persistence
* Order Persistence
* Tracking Persistence
* Status Persistence
* Cancellation Persistence
* Support Persistence
* Rating Persistence

---

# Partially Implemented 

## Registry Integration

### Completed

* Registry lookup
* Shared registry resolver
* Registry cache
* Strict key matching
* Signed vlookup
* Subscriber validation
* SUBSCRIBED status validation
* Key validity checks
* Key rotation handling
* TTL cache
* Negative cache

### Remaining

* Live validation against ONDC pre-prod registry response (untested end-to-end)

---

## Persistence Layer

### Completed

* Prisma integration (Prisma 7 + @prisma/adapter-pg)
* PostgreSQL schema (prisma/schema.prisma)
* ondc_search table
* ondc_search_result table
* ondc_order table
* ondc_event table
* Dual-backend dispatcher (JSON fallback when DATABASE_URL unset)

### Remaining

* Run `prisma migrate dev` against Supabase to create tables
* End-to-end smoke test of writes/reads against the live DB

### Current

* JSON / Blob persistence still available as fallback (store-json.ts)

---

# Not Started 

## Vendor Onboarding

* ondc-site-verification.html
* subscribe flow
* on_subscribe
* Challenge decryption

## Issue & Grievance Management

* issue
* on_issue
* issue_status
* on_issue_status

## Network Observability

* Observability keys
* Observability logs
* Submission flow

## Reconciliation & Settlement

* Reconciliation
* Settlement
* Payout management

## Payments

* Razorpay integration
* Webhook handling
* Payment confirmation flow

---

# Not Yet Tested 

## Workbench Validation

* Search
* Select
* Init
* Confirm
* Status
* Track
* Cancel
* Update
* Support
* Rating

Status: Implemented but not yet validated through ONDC Workbench.

---

# Current Priorities

## Priority 0

* Verify ONDC subscription status
* Verify registry lookup response
* Validate registered keys
* Confirm subscriber is SUBSCRIBED

## Priority 1

* Registry integration hardening

## Priority 2

* Workbench testing

## Priority 3

* Vendor onboarding implementation

---

# Current Blockers

## Registry Verification

The current implementation assumes registry access is functioning.

Need to verify:

* Subscriber status
* Registry lookup response
* Returned public keys
* Pre-production registration status

As noted during discussion, ONDC APIs cannot be validated reliably until subscription status is confirmed.

---

# Notes

OpenIdea is registered as a Buyer NP (BAP) in ONDC Pre-Production.

Current focus is integration validation rather than adding new transaction APIs.


# Immediate Next Steps

1. Verify ONDC Registry subscription status
2. Test registry lookup response
3. Validate signing/encryption keys
4. Begin Workbench testing
5. Record test results in spreadsheet