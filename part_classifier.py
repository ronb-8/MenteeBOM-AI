# part_classifier.py
"""
Part Type Classification System
Automatically classifies parts based on part number patterns and state information
"""

class PartClassifier:
    """Classifies parts based on naming conventions and state information"""
    
    def __init__(self, db_session=None):
        """
        Initialize the classifier
        
        Args:
            db_session: Optional SQLAlchemy session for loading rules from database
        """
        self.db_session = db_session
        self._load_rules()
    
    def _load_rules(self):
        """Load classification rules from database or use hardcoded defaults"""
        # Initialize with hardcoded defaults (for backward compatibility)
        self.sub_system_classifications = {}
        self.printing_indicators = []
        
        # Try to load from database if session is available
        db_session = self.db_session
        
        # If no session provided, try to get from Flask app context
        if not db_session:
            try:
                from flask import has_app_context, current_app
                if has_app_context():
                    from app import db
                    db_session = db.session
            except:
                pass
        
        if db_session:
            try:
                from app import PartClassificationRule
                rules = db_session.query(PartClassificationRule).filter_by(is_active=True).order_by(PartClassificationRule.priority).all()
                
                if rules:
                    # Load rules from database
                    for rule in rules:
                        if rule.classification_method == '3d_printing':
                            if rule.keyword not in self.printing_indicators:
                                self.printing_indicators.append(rule.keyword)
                        else:
                            # For keyword and pattern methods, add to classifications
                            self.sub_system_classifications[rule.keyword] = rule.part_type
                    return
            except Exception as e:
                # If database loading fails, fall back to defaults
                print(f"Warning: Could not load classification rules from database: {e}")
        
        # Fallback to hardcoded defaults
        self._load_default_rules()
    
    def _load_default_rules(self):
        """Load hardcoded default classification rules"""
        # Part type classifications based on gsupdate.py
        self.sub_system_classifications = {
            "-MP-": "Mechanical part", 
            "EL-": "Inhouse electrical part", 
            "ES-": "External electrical part",
            "CB-": "Cables", 
            "ILM": "Motors", 
            "CSG": "Gears", 
            "CPL": "Gears", 
            "-AS-": "Assembly"
        }
        
        # Cross roller bearing keywords
        self.cross_roller_keywords = ["SRAU", "SFT", "SRBE"]
        for keyword in self.cross_roller_keywords:
            self.sub_system_classifications[keyword] = "Cross Roller Bearings"
        
        # Bearing keywords
        self.bearing_keywords = ["SKF", "Bearing", "NSK", "PCM", "PCMF", "bearing", "skf", "PG", "pcmf"]
        for keyword in self.bearing_keywords:
            self.sub_system_classifications[keyword] = "Bearings"
        
        # Fastener keywords
        self.fastener_keywords = ["DIN", "Screw", "Nut", "Washer", "PEM", "ISO", "PIN", "PT-WN", "Pin", "Magnet", "IUTB", "CLS", "BN", "Stand-off","Belleville"]
        for keyword in self.fastener_keywords:
            self.sub_system_classifications[keyword] = "Fasteners"
        
        # 3D printing indicators in state field
        self.printing_indicators = ["3D", "3D Print", "3D Printing", "Print", "Printed"]
    
    def reload_rules(self, db_session=None):
        """
        Reload classification rules from database
        
        Args:
            db_session: Optional SQLAlchemy session (uses existing if not provided)
        """
        if db_session:
            self.db_session = db_session
        self._load_rules()
    
    def classify_part(self, part_number, state=None, description=None):
        """
        Classify a part based on part number, state, and description
        
        Args:
            part_number (str): The part number
            state (str, optional): The state field (used for 3D printing detection)
            description (str, optional): Part description (for additional context)
        
        Returns:
            str: The classified part type
        """
        if not part_number:
            return "Unknown"
        
        part_number = str(part_number).strip()
        state = str(state).strip() if state else ""
        description = str(description).strip() if description else ""
        
        # Check for 3D printing parts first (special case for -MP- parts)
        if "-MP-" in part_number and self._is_3d_printing(state, description):
            return "3D Printing part"
        
        # Check for specific part type patterns
        for keyword, classification in self.sub_system_classifications.items():
            if keyword in part_number:
                return classification
        
        # If no specific pattern found, return default
        return "Unknown"
    
    def _is_3d_printing(self, state, description):
        """
        Check if a part is 3D printed based on state and description
        
        Args:
            state (str): The state field
            description (str): The description field
        
        Returns:
            bool: True if this appears to be a 3D printed part
        """
        combined_text = f"{state} {description}".lower()
        
        for indicator in self.printing_indicators:
            if indicator.lower() in combined_text:
                return True
        
        return False
    
    def get_type_priority(self, part_type):
        """
        Get the priority order for sorting parts by type
        
        Args:
            part_type (str): The part type
        
        Returns:
            int: Priority number (lower = higher priority)
        """
        priority_order = [
            "Assembly",
            "Mechanical part", 
            "3D Printing part",
            "OTS",
            "Motors", 
            "Gears",
            "Cross Roller Bearings",
            "Bearings", 
            "Fasteners", 
            "Inhouse electrical part", 
            "External electrical part",
            "Cables",
            "Unknown"
        ]
        
        try:
            return priority_order.index(part_type)
        except ValueError:
            return len(priority_order)  # Unknown types go to the end
    
    def get_all_types(self):
        """
        Get all possible part types from PartType table if available, otherwise use defaults
        
        Returns:
            list: List of all part types
        """
        # Try to get types from PartType table
        db_session = self.db_session
        if not db_session:
            try:
                from flask import has_app_context, current_app
                if has_app_context():
                    from app import db, PartType
                    db_session = db.session
                    try:
                        part_types = PartType.query.filter_by(is_active=True).order_by(PartType.name).all()
                        if part_types:
                            types = [pt.name for pt in part_types]
                            # Ensure "Unknown" is always included
                            if "Unknown" not in types:
                                types.append("Unknown")
                            return sorted(types)
                    except Exception as e:
                        # If PartType table doesn't exist yet, fall back to defaults
                        print(f"Warning: Could not load part types from database: {e}")
            except:
                pass
        
        # Fallback to hardcoded defaults
        types = list(set(self.sub_system_classifications.values()))
        types.append("3D Printing part")  # Add the special case
        types.append("Unknown")  # Add the default
        return sorted(types)
    
    def get_type_statistics(self, parts_list):
        """
        Get statistics about part types in a list of parts
        
        Args:
            parts_list (list): List of part dictionaries with part_number, state, description
        
        Returns:
            dict: Statistics about part types
        """
        type_counts = {}
        total_parts = len(parts_list)
        
        for part in parts_list:
            part_type = self.classify_part(
                part.get('part_number'),
                part.get('state'),
                part.get('description')
            )
            type_counts[part_type] = type_counts.get(part_type, 0) + 1
        
        # Calculate percentages
        type_stats = {}
        for part_type, count in type_counts.items():
            type_stats[part_type] = {
                'count': count,
                'percentage': round((count / total_parts) * 100, 2) if total_parts > 0 else 0
            }
        
        return type_stats

# Global instance for easy import
# Note: This will use hardcoded defaults until reload_rules() is called with a db session
part_classifier = PartClassifier()

def get_classifier_with_db(db_session):
    """
    Get a classifier instance with database session
    
    Args:
        db_session: SQLAlchemy session
        
    Returns:
        PartClassifier instance with database rules loaded
    """
    return PartClassifier(db_session=db_session)
