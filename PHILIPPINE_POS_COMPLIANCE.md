# 🇵🇭 Philippine POS Compliance Analysis

## Already Working ✅
- PHP currency, Asia/Manila timezone
- Tax-inclusive pricing toggle (essential — all PH prices include VAT)
- 12% VAT rate support
- Cash rounding (whole peso, no centavo coins)
- Receipt header/footer, logo, business info
- Cash drawer sessions, X/Z-reports (basic)
- Gift cards, coupons, loyalty points, store credit
- Layaway, split-tender payments
- Offline queue, multi-location stock
- Audit log, staff permissions, 2FA

---

## 🔴 Critical — BIR Compliance

| Feature | What's Missing |
|---|---|
| **TIN on receipts** | No `tin` field on `tenants`. BIR requires Tax ID on every Official Receipt. |
| **BIR Accreditation No.** | No field for the POS system's BIR permit number. |
| **Machine Serial No.** | No field for the POS machine/printer serial number. |
| **"OFFICIAL RECEIPT" label** | Receipt just says "Receipt" — must say "OFFICIAL RECEIPT". |
| **Unit price per line item** | Receipt shows `qty × name · total` but not the per-unit price. BIR requires it. |
| **SC/PWD discount (R.A. 9994)** | No senior citizen / PWD discount type. Must be exactly 20% + VAT exempt on the discounted portion. |
| **SC/PWD beneficiary info** | No fields for `beneficiary_name`, `beneficiary_id`, `id_type` on orders. BIR audits these. |
| **Discount type classification** | Currently a flat `$` amount. Must distinguish: regular, SC (20%), PWD (20%), percentage (5%/10%). |
| **VAT-exclusive subtotal line** | Receipt shows "Tax (12%)" but not the VAT-exclusive amount separately. BIR requires both. |

---

## 🔴 Critical — Payment Methods

| Method | Status | Why It Matters |
|---|---|---|
| **GCash** | ❌ Missing | ~90M registered users. Dominant e-wallet. Needs own label + QR/ref capture. |
| **Maya (PayMaya)** | ❌ Missing | Second largest e-wallet. Same needs as GCash. |
| **QR Ph (BSP)** | ❌ Missing | BSP's standardized QR — works across GCash, Maya, and all banks. |
| **InstaPay** | ❌ Missing | Real-time inter-bank transfers. Needs reference number capture. |
| **PESONet** | ❌ Missing | Batch bank transfers. Needs reference number capture. |

The current `mobile` method is too generic. In the Philippines, GCash and Maya are treated as distinct payment methods with their own settlement processes.

---

## 🟡 Important — Reports for BIR Filing

| Report | Status | Purpose |
|---|---|---|
| **VAT Summary (Form 2550M/2550Q)** | ❌ Missing | Monthly/quarterly output VAT breakdown for BIR filing. |
| **SC/PWD Discount Summary** | ❌ Missing | All SC/PWD discounts with beneficiary names + IDs for BIR audit trail. |
| **Sales Summary Report** | ⚠️ Partial | `/reports/tax` exists but lacks SC/PWD separation and VAT-exclusive/inclusive breakdown. |
| **Inventory Valuation Report** | ❌ Missing | Total inventory value (stock × cost) for financial statements. |
| **Per-Payment-Method Sales** | ❌ Missing | Sales breakdown by cash/GCash/Maya/card for reconciliation. |
| **Per-Cashier Sales Report** | ❌ Missing | Accountability report grouping sales by staff member. |
| **Cancelled/Refunded Transaction Log** | ❌ Missing | Voided transactions — BIR requires documentation. |
| **Zero-Rated / VAT Exempt Sales** | ❌ Missing | If business has exempt sales, need separate tracking. |

---

## 🟡 Important — Receipt Enhancements

| Feature | Status |
|---|---|
| SC/PWD discount line with 20% clearly shown | ❌ Missing |
| VAT exempt notation on SC/PWD items | ❌ Missing |
| "VAT Exempt" or "Zero-Rated" line items | ❌ Missing |
| Senior Citizen / PWD ID on receipt | ❌ Missing |
| Service charge breakdown (if applicable) | ✅ Exists |
| Tips line | ✅ Exists |
| Change due | ✅ Exists |

---

## 🟢 Nice-to-Have

| Feature | Notes |
|---|---|
| Filipino/Tagalog UI language toggle | English-only UI currently |
| Bilingual receipt (English + Filipino) | Receipt is English only |
| Dried ink printer support (Epson TM-T88) | ESC/POS adapter exists but may need specific PH printer commands |
| BIR-accredited POS integration (CAS/PRMS) | For businesses that need official BIR accreditation |
| Suggested retail price (SRP) enforcement | Some products have regulated prices |
| Batch barcode scanning | For inventory counts |

---

## Implementation Phases

### Phase 1 — BIR Essentials (critical)
1. Add `tin`, `bir_accreditation_no`, `serial_no` to tenants + settings UI
2. Add discount type: `regular | senior | pwd | percentage` + beneficiary fields
3. SC/PWD discount logic: 20% off + VAT exemption on discounted portion
4. Update receipt to BIR Official Receipt format (TIN, unit prices, VAT breakdown, SC/PWD info)
5. Add `gcash` and `maya` payment methods

### Phase 2 — Payment Methods
6. Add GCash, Maya, QR Ph, InstaPay, PESONet as distinct payment methods
7. Reference number capture for bank transfers

### Phase 3 — Reports
8. VAT Summary report for Form 2550M/2550Q
9. SC/PWD Discount Summary report
10. Per-payment-method and per-cashier sales reports
11. Inventory valuation report
