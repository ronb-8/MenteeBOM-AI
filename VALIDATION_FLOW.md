# PO Price Validation - Data Separation Flow

## How Parts vs Additional Costs are Separated

### STEP 1: Extract all items from quotation
```
extracted_prices = {
  "034-MP-05287": {...},           # Regular part
  "034-MP-05287-MASTER": {...},    # Mold cost (suffix detected)
  "034-MP-05287-SILICONE": {...},  # Tooling cost (suffix detected)
  "034-MP-05683": {...},           # Regular part
  ...
}
```

### STEP 2: AI matches RFQ parts with extracted prices
```
RFQ ITEMS (from database):
  - 034-MP-05287
  - 034-MP-05683
  - 034-MP-05684
  - ...

AI MATCHING RESULT:
  matched_prices = {
    "034-MP-05287": {"matched_extracted_part": "034-MP-05287", ...},
    "034-MP-05683": {"matched_extracted_part": "034-MP-05683", ...},
    ...
  }
```

### STEP 3: Identify unmatched items
```
extracted_prices has: 034-MP-05287, 034-MP-05287-MASTER, 034-MP-05287-SILICONE, ...
matched_extracted_parts has: 034-MP-05287, 034-MP-05683, ...

UNMATCHED = Items in extracted_prices but NOT in matched_extracted_parts
  - 034-MP-05287-MASTER (NOT matched - no RFQ part for molds)
  - 034-MP-05287-SILICONE (NOT matched - no RFQ part for tooling)
  - 034-MP-05684-MASTER (NOT matched)
  - ...
```

### STEP 4: Build response data

#### PARTS LIST (parts_data):
```
Lines 11468-11550 in app.py:
for item in rfq_items:  # ONLY RFQ items (PARTS)
    parts_data.append({
        'part_number': '034-MP-05287',
        'unit_cost': $55.00,  # From AI matching
        'quantity': 5,
        'total_cost': $275.00
    })
```
✅ CONTAINS: Only the 6 RFQ parts with prices matched

#### ADDITIONAL COSTS (additional_costs):
```
Lines 11389-11440 in app.py:
for pn, price_data in extracted_prices.items():  # ALL extracted items
    if pn ends with -MOLD, -SILICONE, etc. OR is identified as non-part:
        additional_costs.append({
            'part_number': '034-MP-05287-MASTER',
            'cost_type': 'Mold',
            'unit_cost': $55.00,
            'quantity': 1,
            'total_cost': $55.00
        })
```
✅ CONTAINS: Only non-parts (molds, tooling, labor, etc.)

## Key Guarantees

1. **Naming Convention Detection** (Lines 11396)
   - Items ending with: `-MOLD`, `-TOOLING`, `-SETUP`, `-MASTER`, `-SILICONE`
   - ✅ Go to additional_costs
   - ❌ Never go to parts_data

2. **AI Smart Filtering** (in gemini_quotation_processor.py)
   - Plain part numbers like `034-MP-05287` → SKIPPED (not classified)
   - Cost items like `034-MP-05287-MASTER` → CLASSIFIED as non-parts
   - ❌ Plain part numbers are never classified as non-parts

3. **Separation Logic** (Line 11468)
   - parts_data ONLY loops through `rfq_items` (database RFQ items)
   - additional_costs loops through ALL extracted items
   - ✅ No cross-contamination possible

## What You'll See

### Parts Table (Top):
```
034-MP-05287    REV01   5   $55.00   $275.00
034-MP-05683    REV01   1   $55.00   $55.00
... (only 6 parts from RFQ)
```

### Additional Costs Table (Bottom):
```
Mold    034-MP-05287-MASTER      1   $55.00   $55.00
Mold    034-MP-05287-SILICONE    2   $250.00  $500.00
Mold    034-MP-05683-MASTER      1   $55.00   $55.00
... (only non-parts with cost suffixes)
```

## Summary

✅ Master items → Additional Costs section ONLY
✅ Silicone items → Additional Costs section ONLY
✅ Mold items → Additional Costs section ONLY
✅ Plain parts (034-MP-XXXXX) → Parts section ONLY
✅ NO DUPLICATES between sections
