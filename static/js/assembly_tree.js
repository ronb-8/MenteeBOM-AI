// Assembly Tree Visualization with D3.js

let currentBomId = null;
let treeData = null;
let svg = null;
let g = null;
let zoom = null;
let root = null;
let tree = null;
let i = 0; // Counter for unique node IDs

// Initialize tree visualization
function initializeTree() {
    console.log('Initializing tree...');
    const container = document.getElementById('treeContainer');
    if (!container) {
        console.error('Tree container not found!');
        return;
    }
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    console.log(`Container dimensions: ${width}x${height}`);
    
    // Clear existing SVG
    d3.select('#treeContainer svg').remove();
    
    // Create SVG
    svg = d3.select('#treeContainer')
        .append('svg')
        .attr('class', 'tree-svg')
        .attr('width', width)
        .attr('height', height);
    
    // Create zoom behavior
    zoom = d3.zoom()
        .scaleExtent([0.1, 3])
        .on('zoom', function(event) {
            g.attr('transform', event.transform);
        });
    
    svg.call(zoom);
    
    // Create main group for tree
    g = svg.append('g')
        .attr('class', 'tree-group')
        .attr('transform', `translate(${width / 2}, 50)`);
    
    console.log('Tree group created with transform:', `translate(${width / 2}, 50)`);
    
    // Test rectangle removed - no longer needed
    
    // Create tree layout
    tree = d3.tree()
        .nodeSize([200, 180])
        .separation((a, b) => (a.parent == b.parent ? 1 : 1.2));
    
    console.log('Tree initialized successfully');
}

// Load BOM list
function loadBOMList() {
    console.log('Loading BOM list...');
    fetch('/api/bom-data', {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            console.log('BOM list response:', response);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('BOM list data:', data);
            renderBOMList(data);
        })
        .catch(error => {
            console.error('Error loading BOM list:', error);
            document.getElementById('bomListContainer').innerHTML = `
                <div class="text-center text-danger py-4">
                    <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                    <p class="mb-0">Error loading BOMs: ${error.message}</p>
                </div>
            `;
        });
}

// Render BOM list
function renderBOMList(boms) {
    const container = document.getElementById('bomListContainer');
    
    if (!boms || boms.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="fas fa-database fa-2x mb-2"></i>
                <p class="mb-0">No BOMs available</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    boms.forEach(bom => {
        html += `
            <div class="bom-item" data-bom-id="${bom.id}">
                <div class="bom-item-info">
                    <div class="bom-item-name">${bom.name}</div>
                </div>
                <div class="bom-item-versions">
                    <div class="version-buttons-container" id="versions-${bom.id}">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Load versions for each BOM
    boms.forEach(bom => {
        loadBOMVersionsForTree(bom.id);
    });
}

// Load BOM versions for tree (inline buttons like assembly BOM)
function loadBOMVersionsForTree(bomId) {
    const container = document.getElementById(`versions-${bomId}`);
    if (!container) return;
    
    fetch(`/api/bom/${bomId}/revisions`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.revisions) {
                populateVersionButtons(container, data.revisions, bomId);
            } else {
                container.innerHTML = '<small class="text-muted">No versions</small>';
            }
        })
        .catch(error => {
            console.error('Error loading versions:', error);
            container.innerHTML = '<small class="text-danger">Error</small>';
        });
}

// Track which version is currently presented in the tree
let currentPresentedVersion = null;

function setPresentedVersion(bomId, version) {
    currentPresentedVersion = { bomId, version };
}

function getPresentedVersion() {
    return currentPresentedVersion;
}

function populateVersionButtons(container, versions, bomId) {
    if (!versions || versions.length === 0) {
        container.innerHTML = '<small class="text-muted">No versions</small>';
        return;
    }
    
    // Remove duplicates based on version number
    const uniqueVersions = versions.filter((version, index, self) => 
        index === self.findIndex(v => v.version === version.version)
    );
    
    // Get the currently presented version
    const presented = getPresentedVersion();
    
    let html = '';
    uniqueVersions.forEach(version => {
        const isLatest = version.is_latest;
        const isPresented = presented && presented.bomId == bomId && presented.version === version.version;
        
        // Determine button class based on state
        let buttonClass;
        if (isPresented) {
            buttonClass = 'btn btn-sm btn-purple me-1 mb-1 version-btn';
        } else if (isLatest) {
            buttonClass = 'btn btn-sm btn-primary me-1 mb-1 version-btn';
        } else {
            buttonClass = 'btn btn-sm btn-outline-secondary me-1 mb-1 version-btn';
        }
        
        const latestBadge = isLatest ? ' <span class="badge bg-light text-dark" style="font-size: 0.6rem;">LATEST</span>' : '';
        
        html += `
            <button class="${buttonClass}" 
                    data-version="${version.version}"
                    data-bom-id="${bomId}"
                    onclick="switchToVersionForTree(${version.id}, '${version.version}', ${bomId})"
                    title="${version.change_description || 'No description'}">
                ${version.version}${latestBadge}
            </button>
        `;
    });
    
    container.innerHTML = html;
}

function switchToVersionForTree(versionId, versionNumber, bomId) {
    console.log(`Switching to version ${versionNumber} for BOM ${bomId}`);
    
    // Set this version as the currently presented version
    setPresentedVersion(bomId, versionNumber);
    
    // For the new structure, we don't need to call a switch API
    // We just load the tree data for the specific version ID
    loadBOMTreeRevision(versionId, versionNumber);
    
    // Refresh all version buttons to show current state
    refreshAllVersionButtons();
}


function refreshAllVersionButtons() {
    // Refresh all version button containers
    document.querySelectorAll('.version-buttons-container').forEach(container => {
        const bomId = container.id.replace('versions-', '');
        loadBOMVersionsForTree(bomId);
    });
}

// Load BOM revisions
function loadBOMRevisions(bomId, bomName) {
    console.log(`Loading revisions for BOM ID: ${bomId}, Name: ${bomName}`);
    
    // Show loading modal
    showRevisionsModal(bomId, bomName);
    
    // Fetch revisions from API
    fetch(`/api/bom/${bomId}/revisions`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Revisions data received:', data);
            if (data.success) {
                displayRevisions(data.revisions, bomId, bomName);
            } else {
                showError('Failed to load revisions');
            }
        })
        .catch(error => {
            console.error('Error loading revisions:', error);
            showError('Error loading revisions');
        });
}

// Show revisions modal
function showRevisionsModal(bomId, bomName) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('revisionsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'revisionsModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="revisionsModalTitle">BOM Revisions</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div id="revisionsList">
                            <div class="text-center py-3">
                                <i class="fas fa-spinner fa-spin fa-2x mb-2"></i>
                                <p>Loading revisions...</p>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Set title
    document.getElementById('revisionsModalTitle').textContent = `${bomName} - Revisions`;
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

// Display revisions in modal
function displayRevisions(revisions, bomId, bomName) {
    const revisionsList = document.getElementById('revisionsList');
    
    if (!revisions || revisions.length === 0) {
        revisionsList.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-info-circle fa-2x mb-2"></i>
                <p>No previous revisions found</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    revisions.forEach((revision, index) => {
        const isCurrent = index === 0;
        html += `
            <div class="revision-item border rounded p-3 mb-2 ${isCurrent ? 'bg-light' : ''}">
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <h6 class="mb-1">
                            ${revision.version || `Revision ${index + 1}`}
                            ${isCurrent ? '<span class="badge bg-success ms-2">Current</span>' : ''}
                        </h6>
                        <small class="text-muted">
                            Created: ${revision.created_at ? new Date(revision.created_at).toLocaleDateString() : 'Unknown'}
                        </small>
                    </div>
                    <div class="col-md-4 text-end">
                        <button class="btn btn-sm btn-primary" onclick="loadBOMTreeRevision(${revision.id}, '${bomName}', '${revision.version}')">
                            <i class="fas fa-eye me-1"></i>View Tree
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    revisionsList.innerHTML = html;
}

// Load BOM tree data for specific revision
function loadBOMTreeRevision(revisionId, bomName, version) {
    console.log(`Loading BOM tree for revision ID: ${revisionId}, Name: ${bomName}, Version: ${version}`);
    
    // Close revisions modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('revisionsModal'));
    if (modal) modal.hide();
    
    // Update current BOM ID
    currentBomId = revisionId;
    
    // Update active state
    document.querySelectorAll('.bom-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Update header
    document.getElementById('currentBomName').textContent = `${bomName} (${version})`;
    
    // Show loading
    document.getElementById('treeContainer').innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <p class="mt-2">Loading tree structure...</p>
            </div>
        </div>
    `;
    
    // Fetch tree data for specific revision using new API endpoint
    fetch(`/api/bom-data-new/${revisionId}?view_type=tree`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                treeData = data.tree_data;
                renderTree(treeData);
            } else {
                showError('Failed to load tree data for this revision');
            }
        })
        .catch(error => {
            console.error('Error loading tree:', error);
            showError('Error loading tree structure');
        });
}

// Load BOM tree data
function loadBOMTree(bomId, bomName) {
    console.log(`Loading BOM tree for ID: ${bomId}, Name: ${bomName}`);
    currentBomId = bomId;
    
    // Update active state
    document.querySelectorAll('.bom-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    // Update header
    document.getElementById('currentBomName').textContent = bomName;
    
    // Show loading
    document.getElementById('treeContainer').innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <p class="mt-2">Loading tree structure...</p>
            </div>
        </div>
    `;
    
    // Fetch tree data using new API endpoint
    console.log(`Fetching tree data from: /api/bom-data-new/${bomId}?view_type=tree`);
    fetch(`/api/bom-data-new/${bomId}?view_type=tree`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            console.log('Tree data response:', response);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                treeData = data.tree_data;
                renderTree(treeData);
            } else {
                console.error('Failed to load tree data:', data);
                showError('Failed to load tree data');
            }
        })
        .catch(error => {
            console.error('Error loading tree:', error);
            showError('Error loading tree structure');
        });
}

// Load BOM tree data for version switching (without event.currentTarget)
function loadBOMTreeForVersion(bomId, bomName) {
    console.log(`Loading BOM tree for version ID: ${bomId}, Name: ${bomName}`);
    currentBomId = bomId;
    
    // Update active state
    document.querySelectorAll('.bom-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`.bom-item[data-bom-id="${bomId}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Update header
    document.getElementById('currentBomName').textContent = bomName;
    
    // Show loading
    document.getElementById('treeContainer').innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <p class="mt-2">Loading tree structure...</p>
            </div>
        </div>
    `;
    
    // Fetch tree data using new API endpoint
    console.log(`Fetching tree data from: /api/bom-data-new/${bomId}?view_type=tree`);
    fetch(`/api/bom-data-new/${bomId}?view_type=tree`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => {
            console.log('Tree data response:', response);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                treeData = data.tree_data;
                renderTree(treeData);
            } else {
                console.error('Failed to load tree data:', data);
                showError('Failed to load tree data');
            }
        })
        .catch(error => {
            console.error('Error loading tree:', error);
            showError('Error loading tree structure');
        });
}

// Render tree visualization
function renderTree(data) {
    // Clear the loading overlay first
    const treeContainer = document.getElementById('treeContainer');
    treeContainer.innerHTML = '';
    
    initializeTree();
    
    // Convert data to D3 hierarchy
    root = d3.hierarchy(data, d => d.children);
    root.x0 = 0;
    root.y0 = 0;
    
    // Collapse all children initially except first level
    if (root.children) {
        root.children.forEach(collapse);
    }
    
    update(root);
    
    // Center the view
    centerTree();
}

// Collapse node and its children
function collapse(d) {
    if (d.children) {
        d._children = d.children;
        d._children.forEach(collapse);
        d.children = null;
    }
}

// Update tree visualization
function update(source) {
    const duration = 750;
    
    // Compute new tree layout
    const treeData = tree(root);
    const nodes = treeData.descendants();
    const links = treeData.descendants().slice(1);
    
    // Update nodes
    const node = g.selectAll('g.tree-node')
        .data(nodes, d => d.id || (d.id = ++i));
    
    // Enter new nodes
    const nodeEnter = node.enter()
        .append('g')
        .attr('class', d => `tree-node ${getNodeClass(d.data)}`)
        .attr('transform', d => `translate(${source.x0}, ${source.y0})`)
        .on('click', click);
    
    console.log(`New nodes entering: ${nodeEnter.size()}`);
    
    // Debug: Check if SVG and group exist
    console.log('SVG element:', svg.node());
    console.log('Group element:', g.node());
    console.log('SVG dimensions:', svg.attr('width'), 'x', svg.attr('height'));
    
    // Add node rectangle
    nodeEnter.append('rect')
        .attr('width', 180)
        .attr('height', 90)
        .attr('x', -90)
        .attr('y', -45);
    
    // Add part number at the top (centered)
    const partNumberGroup = nodeEnter.append('g')
        .attr('class', 'part-number-group')
        .attr('transform', 'translate(0, -30)');
    
    partNumberGroup.append('foreignObject')
        .attr('width', 160)
        .attr('height', 25)
        .attr('x', -80)
        .attr('y', -12)
        .append('xhtml:div')
        .attr('class', 'node-part-number')
        .style('text-align', 'center')
        .style('font-weight', '600')
        .style('font-size', '12px')
        .style('color', '#3a3b45')
        .style('line-height', '1.2')
        .style('overflow', 'hidden')
        .style('display', '-webkit-box')
        .style('-webkit-line-clamp', '2')
        .style('-webkit-box-orient', 'vertical')
        .html(d => d.data.name || 'Unknown');
    
    // Add revision below part number
    nodeEnter.append('text')
        .attr('class', 'node-revision')
        .attr('dy', '-5')
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('color', '#858796')
        .text(d => {
            const revision = d.data.bom_columns?.Revision;
            return revision ? `Rev: ${revision}` : 'Rev: N/A';
        });
    
    // Add ECO badge if ECO data exists - positioned next to expand circle
    const ecoGroup = nodeEnter.append('g')
        .attr('class', 'eco-group')
        .attr('transform', 'translate(25, 30)')  // Next to expand circle
        .style('display', d => {
            const ecoNumber = d.data.bom_columns?.ECO_Number || d.data.eco_number;
            return ecoNumber ? 'block' : 'none';
        });
    
    ecoGroup.append('rect')
        .attr('class', 'eco-badge-bg')
        .attr('width', 30)  // Smaller width
        .attr('height', 18)  // Smaller height
        .attr('x', -15)
        .attr('y', -9)
        .attr('rx', 5)
        .attr('ry', 5)
        .attr('fill', '#28a745')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('click', function(event, d) {
            event.stopPropagation();
            showECOTooltip(d);
        });
    
    ecoGroup.append('text')
        .attr('class', 'node-eco-badge')
        .attr('text-anchor', 'middle')
        .attr('dy', '4')
        .attr('font-size', '6px')  // Smaller font
        .attr('text-anchor', 'middle')  // Center the text
        .attr('font-weight', 'bold')
        .attr('fill', '#ffffff')
        .text('ECO')  // Just "ECO" text
        .style('cursor', 'pointer')
        .on('click', function(event, d) {
            event.stopPropagation();
            showECOTooltip(d);
        });
    
    // Add description at the bottom
    const descriptionGroup = nodeEnter.append('g')
        .attr('class', 'description-group')
        .attr('transform', 'translate(0, 6)');
    
    descriptionGroup.append('foreignObject')
        .attr('width', 160)
        .attr('height', 25)
        .attr('x', -80)
        .attr('y', -12)
        .append('xhtml:div')
        .attr('class', 'node-description')
        .style('text-align', 'center')
        .style('font-size', '9px')
        .style('color', '#858796')
        .style('line-height', '1.2')
        .style('overflow', 'hidden')
        .style('display', '-webkit-box')
        .style('-webkit-line-clamp', '2')
        .style('-webkit-box-orient', 'vertical')
        .html(d => d.data.description || d.data.bom_columns?.DESCRIPTION || 'No description');
    
    // Add thumbnail image in left bottom corner
    const thumbnailGroup = nodeEnter.append('g')
        .attr('class', 'thumbnail-group')
        .attr('transform', 'translate(-70, 30)');
    
    // Add thumbnail background rectangle
    thumbnailGroup.append('rect')
        .attr('width', 40)
        .attr('height', 30)
        .attr('x', -20)
        .attr('y', -15)
        .attr('fill', '#f8f9fc')
        .attr('stroke', '#d1d3e2')
        .attr('stroke-width', 1)
        .attr('rx', 4);
    
    // Add thumbnail image or placeholder
    thumbnailGroup.append('image')
        .attr('x', -18)
        .attr('y', -13)
        .attr('width', 36)
        .attr('height', 26)
        .attr('href', d => {
            const thumbnail = d.data.thumbnail;
            if (thumbnail && thumbnail.available && thumbnail.data_base64) {
                return `data:image/png;base64,${thumbnail.data_base64}`;
            } else {
                return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMjYiIHZpZXdCb3g9IjAgMCAzNiAyNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjM2IiBoZWlnaHQ9IjI2IiBmaWxsPSIjZjhmOWZjIi8+CjxwYXRoIGQ9Ik0xOCA4QzE5LjY1NjkgOCAyMSA5LjM0MzE1IDIxIDExQzIxIDEyLjY1NjkgMTkuNjU2OSAxNCAxOCAxNEMxNi4zNDMxIDE0IDE1IDEyLjY1NjkgMTUgMTFDMTUgOS4zNDMxNSAxNi4zNDMxIDggMTggOFoiIGZpbGw9IiNkMWQzZTIiLz4KPHBhdGggZD0iTTEyIDIyQzEyIDE5Ljc5MDkgMTMuNzkwOSAxOCAxNiAxOEgxOEMyMC4yMDkxIDE4IDIyIDE5Ljc5MDkgMjIgMjJIMTJaIiBmaWxsPSIjZDFkM2UyIi8+Cjwvc3ZnPgo=';
            }
        })
        .attr('clip-path', 'url(#thumbnail-clip)')
        .style('cursor', 'pointer')
        .on('click', function(event, d) {
            event.stopPropagation();  // Prevent tree toggle when clicking thumbnail
            showLargeThumbnail(d);
        });
    
    // Add clip path for rounded corners
    svg.append('defs')
        .append('clipPath')
        .attr('id', 'thumbnail-clip')
        .append('rect')
        .attr('x', -18)
        .attr('y', -13)
        .attr('width', 36)
        .attr('height', 26)
        .attr('rx', 4);
    
    // Add expand/collapse icon in middle bottom (colored for parent nodes)
    const expandGroup = nodeEnter.append('g')
        .attr('class', 'expand-group')
        .attr('transform', 'translate(0, 30)')
        .style('display', d => d.children || d._children ? 'block' : 'none');
    
    expandGroup.append('circle')
        .attr('r', 10)
        .attr('fill', d => d.children || d._children ? '#4e73df' : '#6c757d') // Blue for parent, gray for leaf
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2);
    
    // Add quantity badge in bottom-right corner (AFTER expand icon to ensure it's on top)
    const qtyGroup = nodeEnter.append('g')
        .attr('transform', 'translate(70, 30)');
    
    qtyGroup.append('rect')
        .attr('class', 'qty-badge-bg')
        .attr('width', 30)
        .attr('height', 18)
        .attr('x', -15)
        .attr('y', -9)
        .attr('rx', 9)
        .attr('ry', 9)
        .attr('fill', '#4e73df')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2);
    
    qtyGroup.append('text')
        .attr('class', 'node-qty-badge')
        .attr('text-anchor', 'middle')
        .attr('dy', '3')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .attr('fill', '#ffffff')
        .text(d => {
            // Get quantity from multiple possible sources
            const qty = d.data.qty || d.data.bom_columns?.QTY || d.data.bom_columns?.Quantity || d.data.qty || d.data.quantity || '1';
            return qty.toString();
        });
    
    // Update existing nodes
    const nodeUpdate = nodeEnter.merge(node);
    
    nodeUpdate.transition()
        .duration(duration)
        .attr('transform', d => `translate(${d.x}, ${d.y})`);
    
    // Exit old nodes
    const nodeExit = node.exit()
        .transition()
        .duration(duration)
        .attr('transform', d => `translate(${source.x}, ${source.y})`)
        .remove();
    
    console.log(`Nodes exiting: ${nodeExit.size()}`);
    
    // Update links
    const link = g.selectAll('path.tree-link')
        .data(links, d => d.id);
    
    // Enter new links
    const linkEnter = link.enter()
        .insert('path', 'g')
        .attr('class', 'tree-link')
        .attr('d', d => {
            const o = {x: source.x0, y: source.y0};
            return diagonal(o, o);
        });
    
    // Update existing links
    const linkUpdate = linkEnter.merge(link);
    
    linkUpdate.transition()
        .duration(duration)
        .attr('d', d => diagonal(d, d.parent));
    
    // Exit old links
    link.exit()
        .transition()
        .duration(duration)
        .attr('d', d => {
            const o = {x: source.x, y: source.y};
            return diagonal(o, o);
        })
        .remove();
    
    // Store old positions
    nodes.forEach(d => {
        d.x0 = d.x;
        d.y0 = d.y;
    });
    
    console.log('Tree update completed');
    console.log('Node positions:', nodes.map(d => ({name: d.data.name, x: d.x, y: d.y})));
}

// Create curved diagonal path
function diagonal(s, d) {
    return `M ${s.x} ${s.y}
            C ${s.x} ${(s.y + d.y) / 2},
              ${d.x} ${(s.y + d.y) / 2},
              ${d.x} ${d.y}`;
}

// Click handler for nodes
function click(event, d) {
    if (d.children) {
        d._children = d.children;
        d.children = null;
    } else {
        d.children = d._children;
        d._children = null;
    }
    update(d);
}

// Get node class based on part type
function getNodeClass(data) {
    const partNumber = data.name || '';
    if (partNumber.includes('-AS-')) return 'assembly';
    if (partNumber.includes('-MP-')) return 'mechanical-part';
    if (partNumber.includes('EL-') || partNumber.includes('ES-')) return 'electrical-part';
    return '';
}

// Show thumbnail tooltip
function showThumbnailTooltip(event, d) {
    console.log('Showing thumbnail tooltip for:', d.data.name);
    console.log('Thumbnail data:', d.data.thumbnail);
    
    const tooltip = document.getElementById('thumbnailTooltip');
    const thumbnail = d.data.thumbnail;
    
    // Set content
    document.getElementById('tooltipPartNumber').textContent = d.data.name || 'Unknown';
    document.getElementById('tooltipDescription').textContent = d.data.bom_columns?.DESCRIPTION || 'No description';
    document.getElementById('tooltipRevision').textContent = d.data.bom_columns?.Revision || 'N/A';
    document.getElementById('tooltipQuantity').textContent = d.data.qty || '1';
    
    // Set thumbnail image
    const img = document.getElementById('tooltipThumbnail');
    if (thumbnail && thumbnail.available && thumbnail.data_base64) {
        console.log('Setting thumbnail image from base64 data');
        img.src = `data:image/png;base64,${thumbnail.data_base64}`;
        img.style.display = 'block';
    } else {
        console.log('No thumbnail available, hiding image');
        img.style.display = 'none';
    }
    
    // Position tooltip
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = (rect.right + 10) + 'px';
    tooltip.style.top = rect.top + 'px';
    tooltip.classList.add('show');
}

// Show large thumbnail in modal
function showLargeThumbnail(d) {
    const thumbnail = d.data.thumbnail;
    
    if (!thumbnail || !thumbnail.available || !thumbnail.data_base64) {
        alert('No thumbnail available for this part');
        return;
    }
    
    // Create modal if it doesn't exist
    let modal = document.getElementById('largeThumbnailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'largeThumbnailModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="largeThumbnailTitle">Part Thumbnail</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body text-center">
                        <img id="largeThumbnailImage" src="" alt="Large thumbnail" class="img-fluid" style="max-height: 70vh;">
                        <div class="mt-3">
                            <p><strong>Part Number:</strong> <span id="largeThumbnailPartNumber"></span></p>
                            <p><strong>Description:</strong> <span id="largeThumbnailDescription"></span></p>
                            <p><strong>Revision:</strong> <span id="largeThumbnailRevision"></span></p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Set content
    document.getElementById('largeThumbnailTitle').textContent = `${d.data.name} - Thumbnail`;
    document.getElementById('largeThumbnailPartNumber').textContent = d.data.name || 'Unknown';
    document.getElementById('largeThumbnailDescription').textContent = d.data.bom_columns?.DESCRIPTION || 'No description';
    document.getElementById('largeThumbnailRevision').textContent = d.data.bom_columns?.Revision || 'N/A';
    document.getElementById('largeThumbnailImage').src = `data:image/png;base64,${thumbnail.data_base64}`;
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

// Hide thumbnail tooltip
function hideThumbnailTooltip() {
    document.getElementById('thumbnailTooltip').classList.remove('show');
}

// Expand all nodes
function expandAll() {
    function expand(d) {
        if (d._children) {
            d.children = d._children;
            d._children = null;
        }
        if (d.children) {
            d.children.forEach(expand);
        }
    }
    expand(root);
    update(root);
}

// Collapse all nodes
function collapseAll() {
    if (root.children) {
        root.children.forEach(collapse);
    }
    update(root);
}

// Zoom in
function zoomIn() {
    svg.transition().call(zoom.scaleBy, 1.3);
}

// Zoom out
function zoomOut() {
    svg.transition().call(zoom.scaleBy, 0.7);
}

// Fit tree to screen
function fitToScreen() {
    const bounds = g.node().getBBox();
    const parent = svg.node().parentElement;
    const fullWidth = parent.clientWidth;
    const fullHeight = parent.clientHeight;
    const width = bounds.width;
    const height = bounds.height;
    const midX = bounds.x + width / 2;
    const midY = bounds.y + height / 2;
    
    if (width === 0 || height === 0) return;
    
    const scale = Math.min(0.9 / Math.max(width / fullWidth, height / fullHeight), 2);
    const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

// Center tree
function centerTree() {
    const bounds = g.node().getBBox();
    const parent = svg.node().parentElement;
    const fullWidth = parent.clientWidth;
    const fullHeight = parent.clientHeight;
    const width = bounds.width;
    const height = bounds.height;
    const midX = bounds.x + width / 2;
    const midY = bounds.y + height / 2;
    
    const translate = [fullWidth / 2 - midX, fullHeight / 2 - midY];
    
    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]));
}

// Truncate text
function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// Show error message
function showError(message) {
    document.getElementById('treeContainer').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exclamation-triangle text-danger"></i>
            <p>${message}</p>
        </div>
    `;
}

// Show ECO tooltip
function showECOTooltip(d) {
    const ecoNumber = d.data.bom_columns?.ECO_Number || d.data.eco_number;
    const ecoDescription = d.data.bom_columns?.ECO_Description || d.data.eco_description;
    const backwardCompatible = d.data.backward_compatible !== undefined ? d.data.backward_compatible : d.data.bom_columns?.Backward_Compatible;
    
    if (!ecoNumber) return;
    
    // Create modal if it doesn't exist
    let modal = document.getElementById('treeEcoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'treeEcoModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="treeEcoModalTitle">ECO Information</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-sm-3"><strong>Part Number:</strong></div>
                            <div class="col-sm-9" id="treeEcoPartNumber"></div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-3"><strong>Revision:</strong></div>
                            <div class="col-sm-9" id="treeEcoRevision"></div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-3"><strong>ECO Number:</strong></div>
                            <div class="col-sm-9" id="treeEcoNumber"></div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-3"><strong>Description:</strong></div>
                            <div class="col-sm-9" id="treeEcoDescription"></div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-sm-3"><strong>Backward Compatible:</strong></div>
                            <div class="col-sm-9" id="treeEcoBackwardCompatible"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Set content
    document.getElementById('treeEcoModalTitle').textContent = `ECO Information - ${d.data.name}`;
    document.getElementById('treeEcoPartNumber').textContent = d.data.name || 'Unknown';
    document.getElementById('treeEcoRevision').textContent = d.data.bom_columns?.Revision || 'N/A';
    document.getElementById('treeEcoNumber').textContent = ecoNumber || 'N/A';
    document.getElementById('treeEcoDescription').textContent = ecoDescription || 'No description available';
    
    const compatibleText = backwardCompatible ? 'Yes' : 'No';
    const compatibleClass = backwardCompatible ? 'text-success' : 'text-warning';
    document.getElementById('treeEcoBackwardCompatible').innerHTML = `<span class="${compatibleClass}"><strong>${compatibleText}</strong></span>`;
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

// Toolbar button handlers
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('expandAllBtn')?.addEventListener('click', expandAll);
    document.getElementById('collapseAllBtn')?.addEventListener('click', collapseAll);
    document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
    document.getElementById('fitBtn')?.addEventListener('click', fitToScreen);
    document.getElementById('centerBtn')?.addEventListener('click', centerTree);
    
    // Handle window resize
    window.addEventListener('resize', function() {
        if (root) {
            initializeTree();
            update(root);
        }
    });
});

