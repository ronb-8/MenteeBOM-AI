"""
Migration script to add Robot Assembly and MenteeFlow integration tables.
Tables: robot_config, robot_limb, dof_mapping, process_bom_instance,
        manufacturing_process, process_stage, menteeflow_config
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db


def migrate_robot_assembly():
    """Create Robot Assembly and MenteeFlow integration tables"""
    with app.app_context():
        try:
            inspector = db.inspect(db.engine)
            existing_tables = inspector.get_table_names()

            new_tables = [
                'robot_config', 'robot_limb', 'dof_mapping',
                'process_bom_instance', 'manufacturing_process',
                'process_stage', 'menteeflow_config'
            ]

            tables_to_create = [t for t in new_tables if t not in existing_tables]

            if not tables_to_create:
                print("All Robot Assembly tables already exist.")
                return

            print(f"Creating tables: {', '.join(tables_to_create)}")
            db.create_all()
            db.session.commit()
            print(f"Robot Assembly tables created successfully: {', '.join(tables_to_create)}")

        except Exception as e:
            db.session.rollback()
            print(f"Error during migration: {e}")
            import traceback
            traceback.print_exc()
            raise


if __name__ == '__main__':
    migrate_robot_assembly()
