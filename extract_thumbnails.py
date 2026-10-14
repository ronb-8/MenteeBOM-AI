#!/usr/bin/env python3
"""
Standalone script to extract BOM data with thumbnails for debugging purposes.

Usage:
    python extract_thumbnails.py <assembly_name> [--bom-layout LAYOUT] [--configuration CONFIG]

Example:
    python extract_thumbnails.py 029-AS-00855
    python extract_thumbnails.py 029-AS-00855 --bom-layout MenteeBOM --configuration Default
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime
from pdm_bom_parser import PdmBomParser

def main():
    parser = argparse.ArgumentParser(
        description='Extract BOM data with thumbnails for debugging',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python extract_thumbnails.py 029-AS-00855
  python extract_thumbnails.py 029-AS-00855 --bom-layout MenteeBOM --configuration Default
        """
    )
    
    parser.add_argument(
        'assembly_name',
        help='Assembly part name (e.g., 029-AS-00855)'
    )
    
    parser.add_argument(
        '--bom-layout',
        default='MenteeBOM',
        help='BOM layout name (default: MenteeBOM)'
    )
    
    parser.add_argument(
        '--configuration',
        default='Default',
        help='SolidWorks configuration name (default: Default)'
    )
    
    parser.add_argument(
        '--output-dir',
        default=None,
        help='Output directory for JSON file (default: debugging_thumbnails in software directory)'
    )
    
    args = parser.parse_args()
    
    # Get the software directory (where this script is located)
    script_dir = Path(__file__).parent.absolute()
    
    # Create output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = script_dir / 'debugging_thumbnails'
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 70)
    print("BOM Thumbnail Extraction Tool")
    print("=" * 70)
    print(f"Assembly Name: {args.assembly_name}")
    print(f"BOM Layout: {args.bom_layout}")
    print(f"Configuration: {args.configuration}")
    print(f"Output Directory: {output_dir}")
    print("=" * 70)
    print()
    
    # Initialize parser
    try:
        bom_parser = PdmBomParser()
        
        # Validate exporter
        is_valid, message = bom_parser.validate_exporter()
        if not is_valid:
            print(f"❌ Error: {message}")
            sys.exit(1)
        print(f"✅ {message}")
        print()
        
        # Extract BOM data with JSON output (includes thumbnails)
        print("🔄 Extracting BOM data (this may take a while)...")
        print()
        
        bom_data = bom_parser.extract_bom_by_name(
            part_name=args.assembly_name,
            bom_layout=args.bom_layout,
            configuration=args.configuration,
            output_mode="json"  # JSON mode includes thumbnails
        )
        
        if not bom_data:
            print("❌ Error: No BOM data extracted")
            sys.exit(1)
        
        # Count thumbnails
        thumbnail_count = 0
        if 'components' in bom_data:
            thumbnail_count = sum(
                1 for comp in bom_data.get('components', [])
                if comp.get('thumbnail', {}).get('available', False)
            )
        
        print()
        print("=" * 70)
        print(f"✅ BOM extraction complete!")
        print(f"   Total components: {len(bom_data.get('components', []))}")
        print(f"   Components with thumbnails: {thumbnail_count}")
        print("=" * 70)
        print()
        
        # Generate output filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_assembly_name = args.assembly_name.replace('/', '_').replace('\\', '_')
        output_filename = f"{safe_assembly_name}_{timestamp}.json"
        output_path = output_dir / output_filename
        
        # Save JSON file
        print(f"💾 Saving JSON file to: {output_path}")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(bom_data, f, indent=2, ensure_ascii=False)
        
        file_size = output_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        
        print(f"✅ JSON file saved successfully!")
        print(f"   File: {output_filename}")
        print(f"   Size: {file_size_mb:.2f} MB")
        print(f"   Location: {output_path}")
        print()
        
        # Print summary of thumbnails
        if thumbnail_count > 0:
            print("📸 Thumbnail Summary:")
            print("-" * 70)
            for i, comp in enumerate(bom_data.get('components', []), 1):
                thumb = comp.get('thumbnail', {})
                if thumb.get('available', False):
                    part_num = comp.get('part_number', 'Unknown')
                    info = thumb.get('info', {})
                    width = info.get('width', 0)
                    height = info.get('height', 0)
                    format_type = info.get('format', 'unknown')
                    size_bytes = info.get('size_bytes', 0)
                    size_kb = size_bytes / 1024
                    print(f"  {i}. {part_num}: {width}x{height} {format_type} ({size_kb:.1f} KB)")
            print("-" * 70)
        else:
            print("⚠️  No thumbnails found in the extracted data")
        
        print()
        print("=" * 70)
        print("✅ Extraction complete!")
        print(f"📁 JSON file saved to: {output_path}")
        print("=" * 70)
        
    except KeyboardInterrupt:
        print()
        print("❌ Extraction cancelled by user")
        sys.exit(1)
    except Exception as e:
        print()
        print(f"❌ Error during extraction: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

