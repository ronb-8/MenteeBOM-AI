"""
Migration: Fix DIN 912 fastener parts that lost PO data after PDM re-import.

Problem: PDM re-imported these parts with revision "" (empty) instead of "-",
creating new Part records. The old REV="-" records still have po_orders, order_qty,
unit_cost, and inventory data that the new REV="" records are missing.

This script copies the data from old -> new records so the BOMs show correct PO info.
"""

import sqlite3
import sys
import os

def migrate(db_path):
    if not os.path.exists(db_path):
        print(f"ERROR: Database not found: {db_path}")
        return False

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Find all pairs: old REV="-" with PO data, new REV="" without
    c.execute('''
        SELECT old.id as old_id, new.id as new_id, old.part_number,
               old.po_orders, old.order_qty, old.unit_cost, old.inventory,
               new.po_orders, new.order_qty, new.unit_cost, new.inventory
        FROM part old
        JOIN part new ON old.part_number = new.part_number
        WHERE old.revision = '-' AND new.revision = ''
        AND old.po_orders IS NOT NULL AND old.po_orders != '' AND old.po_orders != '[]'
        AND (new.po_orders IS NULL OR new.po_orders = '' OR new.po_orders = '[]')
        ORDER BY old.part_number
    ''')
    pairs = c.fetchall()

    if not pairs:
        print("No parts found that need fixing.")
        conn.close()
        return True

    print(f"Found {len(pairs)} parts to fix:\n")

    for old_id, new_id, pn, old_po, old_oq, old_cost, old_inv, new_po, new_oq, new_cost, new_inv in pairs:
        print(f"  {pn}")
        print(f"    OLD (id={old_id}, rev='-'): po={old_po}, oq={old_oq}, cost={old_cost}, inv={old_inv}")
        print(f"    NEW (id={new_id}, rev=''):  po={new_po}, oq={new_oq}, cost={new_cost}, inv={new_inv}")

        # Copy data from old to new (only if new doesn't already have data)
        c.execute('''
            UPDATE part SET
                po_orders = ?,
                order_qty = ?,
                unit_cost = COALESCE(unit_cost, ?),
                inventory = COALESCE(inventory, ?)
            WHERE id = ?
        ''', (old_po, old_oq, old_cost, old_inv, new_id))

        print(f"    -> Copied to new record (id={new_id})")

    conn.commit()
    print(f"\nDone! Updated {len(pairs)} parts.")

    # Verify
    print("\nVerification:")
    for old_id, new_id, pn, *_ in pairs:
        c.execute('SELECT po_orders, order_qty, unit_cost, inventory FROM part WHERE id = ?', (new_id,))
        row = c.fetchone()
        print(f"  {pn}: po={row[0]}, oq={row[1]}, cost={row[2]}, inv={row[3]}")

    conn.close()
    return True


if __name__ == '__main__':
    # Default to dev database
    db_path = sys.argv[1] if len(sys.argv) > 1 else 'instance/menteebom_dev.db'
    print(f"Running migration on: {db_path}\n")
    migrate(db_path)
