#!/usr/bin/env python3
"""
PDM Integration Configuration for MenteeBOM Web Application
"""

import os
import json
from pathlib import Path

class PDMConfig:
    """Configuration for PDM integration"""
    
    def __init__(self, config_file='pdm_settings.json'):
        self.config_file = config_file
        self.config = self.load_config()
    
    def load_config(self):
        """Load PDM configuration from file"""
        default_config = {
            'pdm_exporter_path': r'C:\Users\mechanical\Documents\MenteeBom software\PdmBomExporter\bin\Debug\PdmBomExporter.exe',
            'vault_name': 'pdm',
            'default_bom_layout': 'MenteeBOM',
            'default_configuration': 'Default',
            'enabled': True,
            'use_native_extractor': False,  # Set True on dev to bypass C# exporter
            'stale_check_enabled': False  # Nightly PDM revision staleness check (requires native extractor)
        }
        
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                    # Merge with defaults to ensure all keys exist
                    for key, value in default_config.items():
                        if key not in config:
                            config[key] = value
                    return config
            except Exception as e:
                print(f"Error loading PDM config: {e}")
                return default_config
        else:
            # Create default config file
            self.save_config(default_config)
            return default_config
    
    def save_config(self, config=None):
        """Save PDM configuration to file"""
        if config is None:
            config = self.config
        
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=4)
            self.config = config
        except Exception as e:
            print(f"Error saving PDM config: {e}")
    
    def get_exporter_path(self):
        """Get the path to the PdmBomExporter executable"""
        return self.config.get('pdm_exporter_path')
    
    def set_exporter_path(self, path):
        """Set the path to the PdmBomExporter executable"""
        self.config['pdm_exporter_path'] = path
        self.save_config()
    
    def is_enabled(self):
        """Check if PDM integration is enabled"""
        return self.config.get('enabled', True)
    
    def set_enabled(self, enabled):
        """Enable or disable PDM integration"""
        self.config['enabled'] = enabled
        self.save_config()
    
    def is_native_extractor_enabled(self):
        """Check if the native Python COM extractor is enabled (dev only)"""
        return self.config.get('use_native_extractor', False)

    def is_stale_check_enabled(self):
        """Check if the nightly PDM revision staleness check is enabled"""
        return self.config.get('stale_check_enabled', False)

    def validate_exporter_path(self):
        """Validate that the PdmBomExporter executable exists.
        When the native extractor is enabled the C# exe is not needed."""
        if self.is_native_extractor_enabled():
            return True, "Native Python extractor enabled — C# exe not required"

        path = self.get_exporter_path()
        if not path:
            return False, "No exporter path configured"

        if not os.path.exists(path):
            return False, f"Executable not found at: {path}"

        return True, "Executable found"
    
    def get_vault_name(self):
        """Get the PDM vault name"""
        return self.config.get('vault_name', 'pdm')
    
    def get_default_bom_layout(self):
        """Get the default BOM layout"""
        return self.config.get('default_bom_layout', 'MenteeBOM')
    
    def get_default_configuration(self):
        """Get the default configuration"""
        return self.config.get('default_configuration', 'Default')

# Global PDM configuration instance
pdm_config = PDMConfig()

