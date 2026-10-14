"""
Scheduler utility for MenteeBOM application.
Handles automatic daily backups and other scheduled tasks.
"""
import os
import zipfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from utils.logger import get_logger, log_action

# Get user's Documents folder path
DOCUMENTS_PATH = Path.home() / "Documents"
MENTEEBOM_DATA_PATH = DOCUMENTS_PATH / "MenteeBOM Data"
BACKUP_DIR = MENTEEBOM_DATA_PATH / "backups"

# Ensure backup directory exists
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Global scheduler instance
scheduler = None


def create_daily_backup(app, db):
    """
    Create a daily backup of the database and configuration files.
    This function is called by the scheduler.
    """
    try:
        logger = get_logger()
        logger.info("Starting scheduled daily backup...")
        
        with app.app_context():
            # Create backup filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"menteebom_backup_{timestamp}.zip"
            backup_path = BACKUP_DIR / backup_filename
            
            # Create ZIP archive
            with zipfile.ZipFile(backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                # Backup database
                db_uri = app.config['SQLALCHEMY_DATABASE_URI']
                if db_uri.startswith('sqlite:///'):
                    db_path = db_uri.replace('sqlite:///', '')
                    if not os.path.isabs(db_path):
                        db_path = os.path.join(app.instance_path, db_path)
                    
                    if os.path.exists(db_path):
                        zipf.write(db_path, 'menteebom.db')
                        logger.info(f"Backed up database: {db_path}")
                
                # Backup configuration files
                # .env is deliberately excluded: secrets live in the vault (docs/BACKUP_SETUP.md)
                config_files = ['pdm_settings.json']
                for config_file in config_files:
                    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), config_file)
                    if os.path.exists(config_path):
                        zipf.write(config_path, config_file)
                        logger.info(f"Backed up config file: {config_file}")
            
            backup_size = backup_path.stat().st_size
            size_str = f"{backup_size / 1024 / 1024:.2f} MB" if backup_size > 1024 * 1024 else f"{backup_size / 1024:.2f} KB"
            
            # Log the action (using a system user since this is automated)
            system_user = {'username': 'system', 'role': 'system'}
            log_action('BACKUP_CREATE', system_user, 
                      f'Scheduled daily backup created: {backup_filename} ({size_str})')
            
            logger.info(f"Daily backup created successfully: {backup_filename} ({size_str})")
            
            # Clean up old backups (keep last 30 days)
            cleanup_old_backups(logger)
            
            return True
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error creating scheduled backup: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def cleanup_old_backups(logger, keep_days=30):
    """
    Clean up old backup files, keeping only the most recent ones.
    
    Args:
        logger: Logger instance
        keep_days: Number of days of backups to keep (default: 30)
    """
    try:
        if not BACKUP_DIR.exists():
            return
        
        # Get all backup files
        backup_files = list(BACKUP_DIR.glob("menteebom_backup_*.zip"))
        if len(backup_files) <= keep_days:
            return
        
        # Sort by modification time (oldest first)
        backup_files.sort(key=lambda p: p.stat().st_mtime)
        
        # Calculate how many to delete
        files_to_delete = backup_files[:-keep_days]
        
        # Delete old backups
        deleted_count = 0
        for backup_file in files_to_delete:
            try:
                backup_file.unlink()
                deleted_count += 1
                logger.info(f"Deleted old backup: {backup_file.name}")
            except Exception as e:
                logger.warning(f"Could not delete old backup {backup_file.name}: {e}")
        
        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} old backup(s), keeping {keep_days} most recent")
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error cleaning up old backups: {str(e)}")


def cleanup_expired_tokens(app, db):
    """Delete expired embed tokens to prevent unbounded table growth."""
    try:
        logger = get_logger()
        with app.app_context():
            from app import EmbedToken
            from sqlalchemy import text as sa_text
            cutoff = datetime.utcnow()
            deleted = EmbedToken.query.filter(
                EmbedToken.expires_at < cutoff
            ).delete(synchronize_session=False)
            db.session.commit()
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} expired embed token(s)")
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error cleaning up expired tokens: {str(e)}")


def weekly_vacuum(app, db):
    """Run VACUUM weekly to reclaim fragmented space."""
    try:
        logger = get_logger()
        with app.app_context():
            from sqlalchemy import text as sa_text
            db.session.execute(sa_text('VACUUM'))
            db.session.commit()
            logger.info("Weekly VACUUM completed successfully")
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error running weekly VACUUM: {str(e)}")


def _has_backup_today():
    """Check if a backup was already created today."""
    today_str = datetime.now().strftime("%Y%m%d")
    for backup_file in BACKUP_DIR.glob(f"menteebom_backup_{today_str}_*.zip"):
        return True
    return False


def start_scheduler(app, db):
    """
    Start the background scheduler for daily backups.
    Also creates a startup backup if no backup exists for today.

    Args:
        app: Flask application instance
        db: SQLAlchemy database instance
    """
    global scheduler

    if scheduler is not None and scheduler.running:
        logger = get_logger()
        logger.warning("Scheduler is already running")
        return

    logger = get_logger()
    logger.info("Initializing background scheduler for daily backups...")

    # Create scheduler
    scheduler = BackgroundScheduler(daemon=True)

    # Schedule daily backup at 2:00 AM
    scheduler.add_job(
        func=lambda: create_daily_backup(app, db),
        trigger=CronTrigger(hour=2, minute=0),  # Run at 2:00 AM daily
        id='daily_backup',
        name='Daily Database Backup',
        replace_existing=True
    )

    # Schedule daily expired token cleanup at 2:30 AM
    scheduler.add_job(
        func=lambda: cleanup_expired_tokens(app, db),
        trigger=CronTrigger(hour=2, minute=30),
        id='daily_token_cleanup',
        name='Daily Expired Token Cleanup',
        replace_existing=True
    )

    # Schedule weekly VACUUM on Sundays at 3:00 AM
    scheduler.add_job(
        func=lambda: weekly_vacuum(app, db),
        trigger=CronTrigger(day_of_week='sun', hour=3, minute=0),
        id='weekly_vacuum',
        name='Weekly Database VACUUM',
        replace_existing=True
    )

    # Schedule nightly PDM revision staleness check at 4:00 AM
    # (after backup/cleanup/vacuum). No-op unless enabled in pdm_settings.json.
    from utils.pdm_stale_check import run_pdm_stale_check
    scheduler.add_job(
        func=lambda: run_pdm_stale_check(app, db),
        trigger=CronTrigger(hour=4, minute=0),
        id='pdm_stale_check',
        name='Nightly PDM Revision Staleness Check',
        replace_existing=True
    )

    # Limb assembly snapshots: re-sync any whose source BOM moved to a new
    # version (one cheap version compare per limb). Re-sync also happens on
    # read; this sweep covers limbs nobody opened since the BOM import so
    # MenteeFlow gets updated stage definitions promptly.
    from utils.limb_snapshot_sync import run_limb_snapshot_sync
    scheduler.add_job(
        func=lambda: run_limb_snapshot_sync(app, db),
        trigger=IntervalTrigger(minutes=5),
        id='limb_snapshot_sync',
        name='Limb Snapshot BOM Re-sync (every 5 min)',
        replace_existing=True
    )

    # If no backup exists for today, schedule one to run 1 minute after startup
    if not _has_backup_today():
        run_time = datetime.now() + timedelta(minutes=1)
        scheduler.add_job(
            func=lambda: create_daily_backup(app, db),
            trigger=DateTrigger(run_date=run_time),
            id='startup_backup',
            name='Startup Backup (no backup found for today)',
            replace_existing=True
        )
        logger.info(f"No backup found for today - scheduling startup backup at {run_time.strftime('%H:%M:%S')}")
    else:
        logger.info("Backup already exists for today - skipping startup backup")

    # Start scheduler
    scheduler.start()
    logger.info("Background scheduler started. Daily backups scheduled for 2:00 AM")

    return scheduler


def stop_scheduler():
    """Stop the background scheduler."""
    global scheduler

    if scheduler is not None and scheduler.running:
        logger = get_logger()
        logger.info("Stopping background scheduler...")
        scheduler.shutdown()
        scheduler = None
        logger.info("Background scheduler stopped")


def get_scheduler_status():
    """Get the current status of the scheduler."""
    global scheduler
    
    if scheduler is None:
        return {'running': False, 'jobs': []}
    
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            'id': job.id,
            'name': job.name,
            'next_run_time': job.next_run_time.isoformat() if job.next_run_time else None
        })
    
    return {
        'running': scheduler.running,
        'jobs': jobs
    }
