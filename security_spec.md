# Security Specification: KawiGrid P2P Energy Trading

## 1. Data Invariants
1. **Identity & Email Verification Invariant**: Every write operation (`create`, `update`, `delete`) across all collections requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`), and `incoming().ownerId == request.auth.uid`.
2. **Master Gate Relational Sync**: Subcollections `/households/{householdId}/private/{docId}`, `/households/{householdId}/transactions/{txId}`, and `/households/{householdId}/dailyMetrics/{dayId}` cannot be read or written unless the parent `/households/{householdId}` document exists and its `ownerId == request.auth.uid`.
3. **PII Split-Collection Isolation**: M-Pesa phone numbers (`mpesaPhone`) and user emails (`email`) are strictly isolated inside `/households/{householdId}/private/{docId}` and never stored on the operational `/households/{householdId}` node. Access is strictly restricted to the verified owner.
4. **Anti-Update-Gap & Immutable Ownership**: Every `update` block must invoke the full `isValid[Entity](incoming())` schema validator first, preserve immutable fields (`ownerId`, `householdId`, `createdAt`), verify `updatedAt == request.time`, and restrict changed fields via `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
5. **Terminal State Locking**: Once an `EnergyTransaction` reaches a terminal status (`COMPLETED` or `FAILED`), no further updates are permitted (`existing().status == 'PENDING'`).
6. **Non-Negative Financial & Energy Balances**: `tokenBalanceKwh`, `withdrawableBalanceKes`, `amountKwh`, and `amountKes` must be non-negative numbers bounded within realistic physical limits.
7. **Secure List Queries**: Every `allow list` rule enforces `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()` inside `list`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing on Household Create)**:
   `{ "ownerId": "victim_uid_999", "meterNumber": "KPLC-88210", "houseName": "Solar Villa", ... }` -> Rejected (`incoming().ownerId == request.auth.uid` fails).
2. **Payload 2 (Unverified Email Write Attempt)**:
   Auth context has `email_verified: false` attempting to create `/households/node_1` -> Rejected (`isVerifiedUser()` fails).
3. **Payload 3 (Shadow Field Injection on Household Create)**:
   Includes required fields plus `"isSuperAdmin": true` -> Rejected (`data.keys().hasOnly(...)` fails).
4. **Payload 4 (Negative Token Balance Injection)**:
   `{ "tokenBalanceKwh": -500, "withdrawableBalanceKes": 1000000, ... }` -> Rejected (`data.tokenBalanceKwh >= 0` fails).
5. **Payload 5 (ID Poisoning / Oversized Path ID)**:
   Path `/households/invalid$id!with*special*chars` -> Rejected (`isValidId(householdId)` regex fails).
6. **Payload 6 (PII Leak Across Users)**:
   Authenticated User B attempts `get` on `/households/user_a_house/private/contact` -> Rejected (Parent ownership check and `existing().ownerId == request.auth.uid` fail).
7. **Payload 7 (Invalid M-Pesa Phone Format in PII Document)**:
   `{ "ownerId": "user_a", "mpesaPhone": "0712-DROP-TABLE", "email": "a@b.com" }` -> Rejected (`mpesaPhone.matches('^\\+?254[17][0-9]{8}$')` fails).
8. **Payload 8 (Orphaned Subcollection Transaction Create)**:
   Creating `/households/non_existent_house/transactions/tx_1` where parent household does not exist -> Rejected (`isHouseholdOwner(householdId)` fails).
9. **Payload 9 (Terminal Transaction State Mutation)**:
   Updating an `EnergyTransaction` whose `existing().status == 'COMPLETED'` back to `'PENDING'` or altering `amountKes` -> Rejected (`existing().status == 'PENDING'` terminal lock fails).
10. **Payload 10 (Immutable `ownerId` / `createdAt` Tampering on Update)**:
    Updating `/households/node_1` with a modified `ownerId` or `createdAt` timestamp -> Rejected (`incoming().ownerId == existing().ownerId && incoming().createdAt == existing().createdAt` fails).
11. **Payload 11 (Client-Forged Timestamp Attack)**:
    Sending `createdAt` or `updatedAt` in the past or future (`request.time + 3600s`) -> Rejected (`incoming().updatedAt == request.time` fails).
12. **Payload 12 (Unauthorized Blanket List Scraping)**:
    Querying `collection(db, 'households/other_house/transactions')` without `where('ownerId', '==', request.auth.uid)` -> Rejected (`resource.data.ownerId == request.auth.uid` fails).

## 3. The Test Runner
Implemented in `/firestore.rules.test.ts` and executed via `tsx --test firestore.rules.test.ts` to verify all 12 Dirty Dozen payloads return `PERMISSION_DENIED` while valid owner operations succeed.
