# Thumbnail Integration for MenteeBOM Web

This document describes the thumbnail integration feature that allows users to see part thumbnails when hovering over part names in the BOM table.

## Overview

The thumbnail integration connects the PDM thumbnail extraction functionality with the MenteeBOM web application, providing a visual way to identify parts in the BOM by showing their thumbnails on hover.

## Features

- **Hover Thumbnails**: Hover over part names to see thumbnail images
- **Visual Indicators**: Thumbnail icons show which parts have thumbnails available
- **Responsive Tooltips**: Thumbnails display in positioned tooltips that avoid screen edges
- **Base64 Integration**: Thumbnails are embedded as base64 data in JSON exports
- **Automatic Detection**: System automatically detects and displays available thumbnails

## How It Works

### 1. PDM Integration
- The web app now uses JSON output mode from the PDM exporter
- JSON exports include base64-encoded thumbnail data
- Thumbnails are extracted using the `IEdmFile15::GetThumbnail2` API

### 2. Data Flow
```
PDM Vault → PdmBomExporter (JSON) → Python Parser → Web App → Hover Tooltip
```

### 3. Web Interface
- Thumbnail icons appear next to part names in the BOM table
- Blue icons indicate thumbnails are available
- Gray icons indicate no thumbnail available
- Hover over blue icons to see the thumbnail image

## Implementation Details

### Backend Changes

#### 1. App.py Updates
- Modified PDM import endpoints to use JSON output mode
- Ensures thumbnail data is included in BOM imports

#### 2. PDM Parser Updates
- Added `_convert_json_to_tree()` method for JSON data
- Preserves thumbnail data in tree structure
- Handles both console and JSON output formats

### Frontend Changes

#### 1. HTML Template Updates
- Added thumbnail icon generation in BOM table
- Integrated hover event handlers
- Added CSS styles for tooltip animations

#### 2. JavaScript Functions
- `showThumbnailTooltip()`: Creates and displays thumbnail tooltip
- `hideThumbnailTooltip()`: Removes thumbnail tooltip
- `positionTooltip()`: Positions tooltip to avoid screen edges

#### 3. CSS Styling
- Tooltip animations and styling
- Icon hover effects
- Responsive positioning

## Usage Instructions

### For Users

1. **Import BOM with Thumbnails**:
   - Click "Import BOM" button
   - Select "JSON File (with thumbnails)" as output mode
   - Enter part name or assembly path
   - Click "Search and Import"

2. **View Thumbnails**:
   - Look for blue thumbnail icons next to part names
   - Hover over the blue icons to see part thumbnails
   - Gray icons indicate no thumbnail is available

3. **Thumbnail Tooltip**:
   - Shows part image with dimensions
   - Displays part number
   - Automatically positions to stay on screen

### For Developers

#### Testing the Integration
```bash
# Run the test script
python test_thumbnail_integration.py

# Start the web application
python app.py
```

#### Adding Thumbnail Support to New Features
1. Ensure JSON output mode is used for PDM imports
2. Check that thumbnail data is preserved in data structures
3. Add thumbnail icons to UI components
4. Implement hover functionality for thumbnail display

## Data Structure

### Thumbnail Data Format
```json
{
  "thumbnail": {
    "available": true,
    "width": 256,
    "height": 256,
    "size_bytes": 15432,
    "format": "Png",
    "data_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

### Tree Node Structure
```json
{
  "name": "029-PT-00123",
  "qty": "2",
  "file": "029-PT-00123.SLDPRT",
  "path": "C:\\PDM\\Projects\\MyProject\\029-PT-00123.SLDPRT",
  "state": "Released",
  "configuration": "Default",
  "level": "1",
  "bom_columns": { ... },
  "thumbnail": { ... },
  "children": []
}
```

## Configuration

### PDM Settings
- Ensure PDM exporter is configured correctly
- Verify thumbnail extraction is working in standalone tests
- Check that JSON output mode includes thumbnail data

### Web App Settings
- Default output mode is set to JSON for thumbnail support
- Tooltip positioning is optimized for different screen sizes
- Thumbnail icons are styled to match the application theme

## Troubleshooting

### Common Issues

1. **No Thumbnails Showing**:
   - Check if PDM exporter is working correctly
   - Verify JSON output mode is being used
   - Ensure parts have thumbnails in PDM

2. **Thumbnail Icons Not Appearing**:
   - Check browser console for JavaScript errors
   - Verify HTML template includes thumbnail functionality
   - Ensure BOM data includes thumbnail information

3. **Tooltips Not Positioning Correctly**:
   - Check if CSS styles are loaded
   - Verify JavaScript functions are defined
   - Test on different screen sizes

### Debug Steps

1. **Check PDM Integration**:
   ```bash
   # Test PDM exporter directly
   PdmBomExporter.exe "029-AS-00855" "MenteeBOM" "Default" json name
   ```

2. **Verify Web Data**:
   - Check browser developer tools
   - Look for thumbnail data in BOM JSON
   - Verify base64 data is present

3. **Test JavaScript**:
   - Open browser console
   - Check for JavaScript errors
   - Test tooltip functions manually

## Performance Considerations

- **Memory Usage**: Base64 thumbnails increase data size significantly
- **Loading Time**: Large BOMs with many thumbnails may load slower
- **Browser Performance**: Many tooltips can impact browser performance

### Optimization Tips
- Consider lazy loading for large BOMs
- Implement thumbnail caching for frequently accessed parts
- Use image compression for smaller file sizes

## Future Enhancements

### Planned Features
1. **Thumbnail Gallery**: View all thumbnails in a grid layout
2. **Thumbnail Downloads**: Save thumbnails as individual files
3. **Thumbnail Resizing**: Different sizes for different use cases
4. **Thumbnail Search**: Find parts by visual similarity

### Technical Improvements
1. **Caching**: Cache thumbnails to reduce PDM API calls
2. **Compression**: Optimize thumbnail file sizes
3. **Lazy Loading**: Load thumbnails on demand
4. **WebP Support**: Use modern image formats for better compression

## Support

For issues or questions regarding thumbnail integration:

1. Check the troubleshooting section above
2. Run the test script to verify functionality
3. Check browser console for JavaScript errors
4. Verify PDM exporter is working correctly
5. Test with a simple part that you know has a thumbnail

## Files Modified

### Backend Files
- `app.py` - Updated PDM import endpoints
- `pdm_bom_parser.py` - Added JSON data handling

### Frontend Files
- `templates/assembly_bom.html` - Added thumbnail functionality

### Test Files
- `test_thumbnail_integration.py` - Integration test script

### Documentation
- `THUMBNAIL_INTEGRATION_README.md` - This documentation
