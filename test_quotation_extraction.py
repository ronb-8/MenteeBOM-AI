#!/usr/bin/env python3
"""
Standalone test script for quotation PDF extraction and part matching.
Usage:
    python test_quotation_extraction.py <pdf_path> [--target-parts part1,part2,...]

Examples:
    # Just extract parts from a PDF:
    python test_quotation_extraction.py "path/to/quotation.pdf"

    # Extract and match against specific target parts:
    python test_quotation_extraction.py "path/to/quotation.pdf" --target-parts "021-MP-03476,021-MP-03477,021-MP-03478"

    # Extract and match against target parts from a text file (one part per line):
    python test_quotation_extraction.py "path/to/quotation.pdf" --target-file "parts_list.txt"
"""

import os
import sys
import json
import argparse
from dotenv import load_dotenv

# Load environment variables (for GEMINI_API_KEY)
load_dotenv()

from gemini_quotation_processor import GeminiQuotationProcessor


def print_separator(title=""):
    print(f"\n{'='*70}")
    if title:
        print(f"  {title}")
        print(f"{'='*70}")


def print_extracted_parts(extracted_parts):
    """Pretty-print extracted parts with pricing."""
    if not extracted_parts:
        print("  No parts extracted!")
        return

    print(f"\n  {'#':<4} {'Part Number':<40} {'Unit Cost':>12} {'Qty':>6} {'Total':>12}")
    print(f"  {'-'*4} {'-'*40} {'-'*12} {'-'*6} {'-'*12}")

    for i, (pn, data) in enumerate(extracted_parts.items(), 1):
        unit = data.get('unit_cost')
        qty = data.get('order_qty')
        total = data.get('total_cost')
        unit_str = f"{unit:.2f}" if unit is not None else "N/A"
        qty_str = str(qty) if qty is not None else "N/A"
        total_str = f"{total:.2f}" if total is not None else "N/A"
        print(f"  {i:<4} {pn:<40} {unit_str:>12} {qty_str:>6} {total_str:>12}")

    print(f"\n  Total parts extracted: {len(extracted_parts)}")


def print_match_results(matched_results, target_parts):
    """Pretty-print matching results."""
    if not matched_results:
        print("  No matches found!")
        return

    matched_count = 0
    exact_count = 0
    close_count = 0
    partial_count = 0
    unmatched = []

    print(f"\n  {'#':<4} {'Target Part':<30} {'Matched To':<30} {'Confidence':<10} {'Unit Cost':>10}")
    print(f"  {'-'*4} {'-'*30} {'-'*30} {'-'*10} {'-'*10}")

    for i, tp in enumerate(target_parts, 1):
        pn = tp['part_number']
        if pn in matched_results:
            info = matched_results[pn]
            matched_pn = info.get('matched_extracted_part', info.get('matched_part_number', '?'))
            confidence = info.get('match_confidence', '?')
            unit = info.get('unit_cost')
            unit_str = f"{unit:.2f}" if unit is not None else "N/A"
            reason = info.get('match_reason', '')

            print(f"  {i:<4} {pn:<30} {str(matched_pn):<30} {confidence:<10} {unit_str:>10}")
            if reason:
                print(f"       Reason: {reason}")

            matched_count += 1
            if confidence == 'exact':
                exact_count += 1
            elif confidence == 'close':
                close_count += 1
            elif confidence == 'partial':
                partial_count += 1
        else:
            print(f"  {i:<4} {pn:<30} {'--- NO MATCH ---':<30} {'none':<10} {'N/A':>10}")
            unmatched.append(pn)

    print_separator("MATCH SUMMARY")
    print(f"  Total target parts:  {len(target_parts)}")
    print(f"  Matched:             {matched_count}")
    print(f"    - Exact:           {exact_count}")
    print(f"    - Close:           {close_count}")
    print(f"    - Partial:         {partial_count}")
    print(f"  Unmatched:           {len(unmatched)}")

    if unmatched:
        print(f"\n  Unmatched parts:")
        for pn in unmatched:
            print(f"    - {pn}")


def main():
    parser = argparse.ArgumentParser(description="Test quotation PDF extraction and part matching")
    parser.add_argument("pdf_path", help="Path to the quotation PDF file")
    parser.add_argument("--target-parts", help="Comma-separated list of target part numbers to match against")
    parser.add_argument("--target-file", help="Path to a text file with target part numbers (one per line)")
    parser.add_argument("--mp-filter", action="store_true", help="Filter for -MP- parts only (like when filename contains -MP-)")
    parser.add_argument("--no-ai-match", action="store_true", help="Force simple matching instead of AI matching")
    args = parser.parse_args()

    # Validate PDF path
    if not os.path.exists(args.pdf_path):
        print(f"Error: File not found: {args.pdf_path}")
        sys.exit(1)

    # Check API key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("Warning: GEMINI_API_KEY not set in environment or .env file")
        print("Set it with: export GEMINI_API_KEY=your_key_here")
        sys.exit(1)

    # Initialize processor
    print_separator("INITIALIZING")
    processor = GeminiQuotationProcessor()

    if not processor.model:
        print("Error: Gemini model failed to initialize")
        sys.exit(1)

    # Step 1: Extract parts from PDF
    print_separator("STEP 1: EXTRACTING PARTS FROM PDF")
    print(f"  File: {args.pdf_path}")
    print(f"  Size: {os.path.getsize(args.pdf_path) / 1024:.1f} KB")
    has_mp = args.mp_filter or '-MP-' in os.path.basename(args.pdf_path)
    if has_mp:
        print("  -MP- filter: ENABLED (will prioritize -MP- parts)")

    try:
        extracted_parts = processor.extract_from_quotation(args.pdf_path)
    except Exception as e:
        print(f"\n  Error during extraction: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print_separator("EXTRACTION RESULTS")
    print_extracted_parts(extracted_parts)

    # Also dump raw JSON for debugging
    print_separator("RAW EXTRACTED JSON")
    print(json.dumps(extracted_parts, indent=2, ensure_ascii=False))

    # Step 2: Match if target parts provided
    target_parts = []

    if args.target_parts:
        for pn in args.target_parts.split(','):
            pn = pn.strip()
            if pn:
                target_parts.append({'part_number': pn})

    if args.target_file:
        if not os.path.exists(args.target_file):
            print(f"Error: Target file not found: {args.target_file}")
            sys.exit(1)
        with open(args.target_file, 'r', encoding='utf-8') as f:
            for line in f:
                pn = line.strip()
                if pn and not pn.startswith('#'):
                    target_parts.append({'part_number': pn})

    if target_parts:
        print_separator(f"STEP 2: MATCHING {len(target_parts)} TARGET PARTS")

        if args.no_ai_match:
            print("  Using simple pattern matching (--no-ai-match flag)")
            matched = processor._simple_part_matching(target_parts, extracted_parts)
        else:
            print("  Using AI matching (with simple matching fallback)")
            matched = processor.match_parts_intelligently(target_parts, extracted_parts)

        print_separator("MATCHING RESULTS")
        print_match_results(matched, target_parts)
    else:
        print_separator("SKIPPING MATCHING")
        print("  No target parts provided. Use --target-parts or --target-file to test matching.")
        print("  Example: python test_quotation_extraction.py quotation.pdf --target-parts \"PART-001,PART-002\"")


if __name__ == '__main__':
    main()
