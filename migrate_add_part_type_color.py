"""
Migration script to add color column to part_type table
Run this script to add the color field to existing part_type table
"""
import sqlite3
import os
from pathlib import Path

def find_database():
    """Find the database file in common locations"""
    possible_paths = [
        Path(__file__).parent / 'menteebom.db',
        Path(__file__).parent / 'instance' / 'menteebom.db',
        Path.home() / 'Documents' / 'MenteeBOM Data' / 'menteebom.db',
    ]
    
    for path in possible_paths:
        if path.exists():
            return path
    
    # Try to find any .db file in the current directory
    current_dir = Path(__file__).parent
    db_files = list(current_dir.glob('*.db'))
    if db_files:
        return db_files[0]
    
    return None

def migrate_add_part_type_color():
    """Add color column to part_type table and set default colors"""
    db_path = find_database()
    
    if not db_path:
        print("ERROR: Could not find database file. Please specify the path manually.")
        return False
    
    print(f"Database found at: {db_path}")
    
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # Check if color column already exists
        cursor.execute("PRAGMA table_info(part_type)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'color' in columns:
            print("Column 'color' already exists in part_type table")
            conn.close()
            return True
        
        # Add the column
        print("Adding color column to part_type table...")
        cursor.execute("ALTER TABLE part_type ADD COLUMN color VARCHAR(20) DEFAULT '#6c757d'")
        conn.commit()
        print("SUCCESS: Column added")
        
        # Set default colors for existing part types
        print("\nSetting default colors for existing part types...")
        default_colors = {
            'Assembly': '#1976d2',
            'Mechanical part': '#7b1fa2',
            '3D Printing part': '#f57c00',
            'OTS': '#0097a7',
            'Inhouse electrical part': '#388e3c',
            'External electrical part': '#388e3c',
            'Bearings': '#c2185b',
            'Cross Roller Bearings': '#c2185b',
            'Fasteners': '#689f38',
            'Cables': '#00796b',
            'Motors': '#f9a825',
            'Gears': '#7b1fa2',
            'Unknown': '#6c757d'
        }
        
        updated_count = 0
        for type_name, color in default_colors.items():
            cursor.execute("""
                UPDATE part_type 
                SET color = ? 
                WHERE name = ?
            """, (color, type_name))
            if cursor.rowcount > 0:
                updated_count += 1
        
        conn.commit()
        conn.close()
        print(f"SUCCESS: Updated colors for {updated_count} part types")
        return True
        
    except Exception as e:
        print(f"ERROR during migration: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()
            conn.close()
        return False

if __name__ == '__main__':
    print("Starting migration: Add color column to part_type table")
    print("=" * 60)
    migrate_add_part_type_color()
    print("=" * 60)
    print("Migration completed!")
