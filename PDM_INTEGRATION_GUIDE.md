# PDM Integration Guide for MenteeBOM Web Application

## Overview

The MenteeBOM Web Application includes full PDM (Product Data Management) integration that allows you to import BOM data directly from your SolidWorks PDM vault, just like in your desktop application.

## Prerequisites

1. **PdmBomExporter C# Application**: Your existing PdmBomExporter executable must be available
2. **PDM Vault Access**: You need access to your PDM vault
3. **SolidWorks PDM**: The PDM system must be properly configured

## Setup Instructions

### 1. Configure PDM Integration

1. **Access Admin Panel**: Login as admin and go to the Admin panel
2. **Navigate to PDM Tab**: Click on the "PDM Integration" tab
3. **Configure Settings**:
   - **Enable PDM Integration**: Check this to enable the feature
   - **PdmBomExporter Path**: Set the path to your PdmBomExporter.exe
     - Default: `C:\Users\mechanical\Documents\MenteeBom software\PdmBomExporter\bin\Debug\PdmBomExporter.exe`
   - **PDM Vault Name**: Usually "pdm" (your vault name)
   - **Default BOM Layout**: Choose your preferred layout (MenteeBOM recommended)
   - **Default Configuration**: Usually "Default"

4. **Save Configuration**: Click "Save Configuration"
5. **Test Connection**: Click "Test Connection" to verify everything works

### 2. Verify Status

The PDM Status panel shows:
- **Integration Status**: Enabled/Disabled
- **Executable Status**: Valid/Invalid (checks if PdmBomExporter.exe exists)
- **Vault Connection**: Connected/Failed (tests PDM connectivity)

## Using PDM Integration

### Import BOM from PDM

1. **Go to Assembly BOM**: Navigate to the Assembly BOM page
2. **Click "Import from PDM"**: This opens the PDM import modal
3. **Enter Assembly Path**: 
   - Format: `C:\pdm\...\your_assembly.sldasm`
   - Must contain "pdm" in the path
   - Example: `C:\pdm\Projects\ProductA\Assembly.sldasm`
4. **Set BOM Name**: Give your imported BOM a name
5. **Choose Options**:
   - **BOM Layout**: Select the layout to use
   - **Configuration**: Choose the assembly configuration
   - **Output Mode**: Console, JSON, or Both
6. **Click "Import from PDM"**: The system will extract BOM data and save it

### What Happens During Import

1. **Path Validation**: Checks that the path contains "pdm"
2. **Executable Check**: Verifies PdmBomExporter.exe exists
3. **BOM Extraction**: Runs the C# executable to extract BOM data
4. **Data Processing**: Parses the output and converts to JSON
5. **Database Storage**: Saves the BOM to the web application database
6. **Display**: Shows the imported BOM structure

## Troubleshooting

### Common Issues

1. **"Executable not found"**
   - Check the path in PDM configuration
   - Ensure PdmBomExporter.exe exists at the specified location
   - Verify the path is correct for your system

2. **"PDM integration not available"**
   - The PdmBomExporter dependencies may be missing
   - Check that the C# application is properly built
   - Verify all required DLLs are present

3. **"Invalid path"**
   - Ensure the assembly path contains "pdm"
   - Check that the path format is correct
   - Verify the assembly file exists in PDM

4. **"Error extracting BOM from PDM"**
   - Check PDM vault connectivity
   - Verify you have access to the assembly file
   - Ensure the assembly file is not locked by another user

### Debug Steps

1. **Check PDM Configuration**:
   - Go to Admin → PDM Integration
   - Verify all settings are correct
   - Test the connection

2. **Verify File Paths**:
   - Ensure PdmBomExporter.exe exists
   - Check assembly file path in PDM
   - Verify vault name is correct

3. **Check Permissions**:
   - Ensure web application has access to PdmBomExporter
   - Verify PDM vault access permissions
   - Check file system permissions

## Advanced Configuration

### Custom PDM Settings

You can modify the PDM configuration file directly:
- File: `pdm_settings.json`
- Location: Same directory as the web application
- Format: JSON configuration

### Integration with Existing Workflow

The PDM integration works seamlessly with your existing workflow:
1. **Import from PDM**: Extract BOM data from SolidWorks assemblies
2. **View and Edit**: Use the web interface to review and modify BOMs
3. **Export**: Send data to Google Sheets or export as CSV
4. **Collaborate**: Share BOMs with your team through the web interface

## Security Considerations

- PDM credentials are handled by the existing PdmBomExporter
- The web application only calls the executable
- No PDM passwords are stored in the web application
- All PDM access follows your existing security policies

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your PdmBomExporter is working in the desktop application
3. Test PDM connectivity outside the web application
4. Check the application logs for detailed error messages

## Migration from Desktop App

The web application uses the same PDM integration as your desktop application:
- Same PdmBomExporter executable
- Same BOM extraction logic
- Same PDM vault access
- Enhanced web interface for better collaboration

