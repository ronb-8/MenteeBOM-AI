"""
Script to update colors for all existing part types
This will set colors for part types that don't have them or update them
"""
import sqlite3
from pathlib import Path

def find_database():
    """Find the database file"""
    possible_paths = [
        Path(__file__).parent / 'instance' / 'menteebom.db',
        Path(__file__).parent / 'menteebom.db',
    ]
    
    for path in possible_paths:
        if path.exists():
            return path
    return None

def update_colors():
    """Update colors for all part types"""
    db_path = find_database()
    
    if not db_path:
        print("ERROR: Could not find database file")
        return False
    
    print(f"Database found at: {db_path}")
    
    # Extended color mapping with more types
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
        'Unknown': '#6c757d',
        # Additional types with case variations
        'Battery': '#ff9800',
        'Electrical OTS': '#0097a7',
        'Inhouse Electrical Part': '#388e3c',
        'Inhouse electrical part': '#388e3c',
    }
    
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # Get all part types
        cursor.execute("SELECT id, name, color FROM part_type")
        all_types = cursor.fetchall()
        
        print(f"\nFound {len(all_types)} part types")
        updated_count = 0
        
        for type_id, type_name, current_color in all_types:
            # Check if we have a color for this type (case-insensitive)
            color = None
            for key, value in default_colors.items():
                if key.lower() == type_name.lower():
                    color = value
                    break
            
            # If no match found, assign a default color based on type name patterns
            if not color:
                type_lower = type_name.lower()
                if 'bearing' in type_lower:
                    color = '#c2185b'
                elif 'fastener' in type_lower or 'screw' in type_lower or 'bolt' in type_lower:
                    color = '#689f38'
                elif 'electrical' in type_lower or 'battery' in type_lower:
                    color = '#388e3c'
                elif 'motor' in type_lower:
                    color = '#f9a825'
                elif 'gear' in type_lower:
                    color = '#7b1fa2'
                elif 'cable' in type_lower or 'wire' in type_lower:
                    color = '#00796b'
                elif 'assembly' in type_lower:
                    color = '#1976d2'
                elif '3d' in type_lower or 'print' in type_lower:
                    color = '#f57c00'
                elif 'ots' in type_lower:
                    color = '#0097a7'
                else:
                    color = '#6c757d'  # Default gray
            
            # Update if color is different or null
            if current_color != color:
                cursor.execute("UPDATE part_type SET color = ? WHERE id = ?", (color, type_id))
                print(f"  Updated '{type_name}': {current_color or 'NULL'} -> {color}")
                updated_count += 1
            else:
                print(f"  '{type_name}': {color} (already set)")
        
        conn.commit()
        conn.close()
        
        print(f"\nSUCCESS: Updated colors for {updated_count} part types")
        return True
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.close()
        return False

if __name__ == '__main__':
    print("Updating colors for all part types...")
    print("=" * 60)
    update_colors()
    print("=" * 60)
    print("Done!")
