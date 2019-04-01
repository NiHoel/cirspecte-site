/**
 * Classes: point, line, layerGroup, controlGroup, mapViewer
 * 
 * Usage:
 * Call create*, delete* and update* on an instance of the mapViewer class to manipulate
 * points, lines, layerGroups and controlGroups.
 *
 * Implementation details:
 * Interface to leaflet.
 * controlGroup > layerGroup > point form a hierarchy
 * lines are contained in a separate layer
 * */

///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: point
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of a vertex on the map.
 * Style depends on the type of the vertex.
 * */
class point {
    get [Symbol.toStringTag]() {
        return 'Point';
    }

    /**
     * @constructor
     * @param {vertex} v
    * @param {string} type
    * @param {json} options
     */
    constructor(v, type, options = {}) {
        this.vertex = v;
        v.point = this;

        if (type === this.EDIT) {
            this.layer = new L.Marker(v.coordinates, options);
        } else {
            this.layer = new L.circleMarker(v.coordinates, options);
        }
        this.type = type;
    }

    /**
     * @returns {[Number]}
     */
    getCoordinates() {
        return latLngToCoords(this.layer.getLatLng());
    }

    /**
     * 
     * @param {string} type
     * @param {EventListener | Function} listener
    * @param {boolean} [useCapture]
     */
    addEventListener(type, listener, useCapture) {
        this.layer.addEventListener(type, (e) => { e.target = this; listener(e); }, useCapture);
    }

    /**
 * 
 * @param {[Number]} coords
 */
    setCoordinates(coords) {
        this.layer.setLatLng(coordsToLatLng(coords));
    }
}

point.prototype.PANORAMA = 'panorama';
point.prototype.PLACEHOLDER = 'placeholder';
point.prototype.EDIT = 'edit';
point.prototype.LANDMARK = 'landmark';

point.prototype.COORDINATES = 'coordinates';


///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: line
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of an edge on the map.
 * Style depends on the type of the edge.
 * */
class line {
    get [Symbol.toStringTag]() {
        return 'Line';
    }

    /**
     * 
     * @param {edge} e
     * @param {string} type
     * @param {json} options
     */
    constructor(e, type, options = {}) {
        this.edge = e;
        e.line = this;
        if (e.opposite != null)
            e.opposite.line = this;

        this.layer = new L.Polyline([e.from.coordinates, e.to.coordinates], options);
        this.type = type;
    }

    /**
     * @returns {[[Number]]}
     */
    getCoordinates() {
        return latLngsToCoords(this.layer.getLatLngs());
    }

    /**
     * 
     * @param {string} type
     * @param {EventListener | Function} listener
    * @param {boolean} [useCapture]
     */
    addEventListener(type, listener, useCapture) {
        this.layer.addEventListener(type, (e) => { e.target = this; listener(e); }, useCapture);
    }

    /**
     * 
     * @param {[[Number]]} coords
     * @returns {layer}
     */
    setCoordinates(coords) {
        return this.layer.setLatLngs(coordsToLatLngs(coords));
    }
}

line.prototype.ROUTE = 'route'; // edge is part of a tour
line.prototype.TEMP = 'temp'; // edge is created for temporary display
line.prototype.EDIT = 'edit';
line.prototype.LANDMARK = 'landmark';
line.prototype.SPATIAL = 'spatial';


///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: controlGroup
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of a temporal group on the map.
 * Used to show / hide contained points
 * */
class controlGroup {
    /**
     *
     * @param {spatialGroup} g
     */
    constructor(g) {
        this.label = g.name;
        this.temporalGroup = g;
        g.controlGroup = this;
        this.layer = new L.featureGroup();
    }

    /**
 * 
 * @param {string} type
 * @param {EventListener | Function} listener
* @param {boolean} [useCapture]
 */
    addEventListener(type, listener, useCapture) {
        this.layer.addEventListener(type, (e) => { e.target = this; listener(e); }, useCapture);
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: layerGroup
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Representation of a spatialGroup on the map.
 * Aggregates points.
 * */
class layerGroup {
    /**
     *
     * @param {spatialGroup} g
     */
    constructor(g) {
        this.spatialGroup = g;
        g.layerGroup = this;

        this.layer = new L.featureGroup();
    }

    /**
 * 
 * @param {string} type
 * @param {EventListener | Function} listener
* @param {boolean} [useCapture]
 */
    addEventListener(type, listener, useCapture) {
        this.layer.addEventListener(type, (e) => { e.target = this; listener(e); }, useCapture);
    }
}


///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: mapViewer
//
///////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Listen to events: this.observe(<class>, <action>).subscribe(elem => / do something with element here /)
 * where <class> in {line, point, layerGroup, controlGroup}
 * <action> in {this.CREATE, this.DELETE, this.SHOW, this.HIDE, this.CLICK}
 * special combinations (this.COORDINATES, this.GPS), (point, this.DRAG), (this.COORDINATES, this.CLICK)
 * */
class mapViewer extends observable {
    get [Symbol.toStringTag]() {
        return 'Map Viewer';
    }

    /**
    *
    * @param {string} domElement
    * @param {configurator} settings
    *
    **/
    constructor(domElement, config, settings) {
        super();
        this.config = config;
        this.settings = settings;
        this.map = new L.Map(domElement, config.options);

        let parent = this.map.getContainer().parentElement;

        parent.addEventListener('transitionend', () => this.map.invalidateSize());


        //layer to map element lookup
        this.layers = new Map();
        this.locationLayer = new L.featureGroup();
        this.lineGroup = new L.featureGroup();
        this.lineGroup.setZIndex(10);
        this.lineGroup.addEventListener('add', event => {
            this.lineGroup.bringToBack();
        });

        // initialize tile grid with offline capabilities
        var tileLayers = config.tileLayers.map(
            l => {
                var arg0, arg1;
                if (l.url) {
                    arg0 = l.url;
                    arg1 = l.options;
                } else {
                    arg0 = l.options;
                }
                var constr = L[l.base];
                var ctx = L;

                if (constr == null)
                    console.error(this.ERROR.UNDEFINED_NAMESPACE, "", l.base);

                if (l.plugin) {
                    ctx = constr;
                    constr = constr[l.plugin];

                    if (constr == null)
                        console.error(this.ERROR.UNDEFINED_NAMESPACE, "", l.base + "." + l.plugin);
                }

                return {
                    label: l.label,
                    offline: l.plugin === "offline",
                    layer: constr.bind(ctx)(arg0, arg1).addTo(this.map)
                };
            }
        );


        // set up structure for layer control panel
        this.baseTree = {
            label: 'BaseLayers',
            noShow: true,
            children: tileLayers
        };

        this.overlayTree = [];
        if (this.config.findAccuratePosition)
            this.overlayTree.push({
                label: this.config.strings.location,
                layer: this.locationLayer
            });

        this.overlayTree.push({
            label: this.config.strings.connections,
            layer: this.lineGroup
        });
        this.layerControl = L.control.layers.tree(this.baseTree, this.overlayTree, config.tree);
        this.layerControl.addTo(this.map).collapseTree().expandSelected();


        // set up event listeners for storing tiles
        tileLayers.forEach(tl => {
            this.layers.set(tl.layer, tl);

            setTimeout(function () {
                //Remove Google Maps overlay "Do you own this site?"
                //The overlay "For development purpose" is not removed because otherwise reloading tiles fails
                if (tl.layer._mutantContainer && tl.layer._mutantContainer.children.length) {
                    for (var c of tl.layer._mutantContainer.children)
                        if (c.children.length > 1)
                            c.hidden = true;
                }
            }, 5000);

            //events while saving a tile layer

            var progress;
            tl.layer.on('savestart', e => {
                progress = 0;
                $('#save-tiles-progress').text(progress);
                $('#save-tiles-total').text(e._tilesforSave.length);
                $('#save-tiles-dialog').modal('show');
            });
            tl.layer.on('savetileend', e => {
                progress++;
                $('#save-tiles-progress').text(progress);
            });


            tl.layer.on('loadend', e => {
                if (($("#save-tiles-dialog").data('bs.modal') || {}).isShown)
                    $('#save-tiles-dialog').modal('hide');
                else
                    alert(this.config.strings.savedAllTiles);
            });
            tl.layer.on('tilesremoved', e => {
                alert(this.config.strings.removedAllTiles);
            });
        });

        // events when toggling visibility of layers or clicking features
        this.map.addEventListener('click', e => this.emit(latLngToCoords(e.latlng), this.CLICK, this.COORDINATES));
        this.map.addEventListener('layeradd', e => {
            let elem = this.layers.get(e.layer);
            if (elem)
                this.emit(elem, this.SHOW);
            if (e.layer == this.locationLayer)
                this.map.findAccuratePosition(this.config.findAccuratePosition);

        });
        this.map.addEventListener('layerremove', e => {
            let elem = this.layers.get(e.layer);
            if (elem instanceof layerGroup)
                if (elem)
                    this.emit(elem, this.HIDE);
        });
        this.map.addEventListener('baselayerchange', e => {
            if (this.controlSaveTiles) {
                this.map.removeControl(this.controlSaveTiles);
            }
            this.controlSaveTiles = null;
            let l = this.layers.get(e.layer);
            if (l.offline) {
                this.controlSaveTiles = L.control.savetiles(l.layer, this.config.saveTilesControl);
                this.controlSaveTiles.addTo(this.map);
            }

            setTimeout(function () {
                //Remove Google Maps overlay "Do you own this site?"
                //The overlay "For development purpose" is not removed because otherwise reloading tiles fails
                if (l.layer._mutantContainer && l.layer._mutantContainer.children.length) {
                    for (var c of l.layer._mutantContainer.children)
                        if (c.children.length > 1)
                            c.hidden = true;
                }
            }, 1000);
        });

        setTimeout(() => this.map.invalidateSize(), 1000);

        // GPS position marking
        var locationCircle;
        var locationMarker;
        var markLocation = (e) => {
            var radius = e.accuracy / 2;

            if (locationCircle) {
                locationCircle.remove();
                locationMarker.remove();
                this.locationLayer.removeLayer(locationCircle);
                this.locationLayer.removeLayer(locationMarker);
            }

            locationCircle = L.circle(e.latlng, Object.assign({}, this.config.point.location, { radius: radius })).addTo(this.locationLayer);
            locationMarker = L.circleMarker(e.latlng, Object.assign({}, this.config.point.location)).addTo(this.locationLayer);

            this.emit(latLngToCoords(e.latlng), this.GPS, this.COORDINATES);
        };
        this.map.on('accuratepositionprogress', markLocation);
        this.map.on('accuratepositionfound', markLocation);

        // Listen when values in configurator change
        this.settings.map.zoom.subscribe(val => {
            if (val != null)
                this.setView(null, val);
        });
        this.settings.map.minZoom.subscribe(val => this.map.setMinZoom(val));
        this.settings.map.maxZoom.subscribe(val => this.map.setMaxZoom(val));
        this.settings.map.center.subscribe(val => {
            if (val)
                this.setView(val);
        });
        this.settings.map.maxBounds.subscribe(val => this.map.setMaxBounds(val));

        this.map.on('moveend', ev => {
            delete this.moveTarget;
        });
    }

    /**
     * @returns {boolean} - in minimap status?
     * */
    isMinimap() { return this.map.isMinimap(); }

    /**
     * 
     * @param {boolean} [enable]
     */
    toggleMinimap(enable) {
        if (enable != this.isMinimap())
            this.map.toggleMinimap();
    }

    /**
     *
     * @param {line | point } elem
     */
    isVisible(elem) {
        return this.map.hasLayer(elem.layer);
    }

    /**
     * 
     * @returns [Number]
     */
    getCenter() {
        let latlng = this.map.getCenter();
        return [latlng.lat, latlng.lng];
    }

    /**
      * 
      * @returns Number
      */
    getZoom() {
        return this.map.getZoom();
    }

	/**
     * 
     * @returns [[Number]]
     */
    getBoundsArray() {
        let bounds = this.getBounds();
        return [[bounds.getSouthWest().lat, bounds.getSouthWest().lng],
        [bounds.getNorthEast().lat, bounds.getNorthEast().lng]];
    }

    /**
 * 
 * @returns {Bounds}
 */
    getBounds() {
        return this.map.getBounds()
    }

    /**
 * Derives the container from the corresponding model elements
 * 
 * @private
 * @param {controlGroup | spatialGroup | point} mapelem
* @returns {controlGroup | spatialGroup}
 */
    deriveParent(mapelem) {
        var elem = mapelem.vertex || mapelem.spatialGroup || mapelem.temporalGroup;
        if (elem == null)
            throw new error(this.ERROR.INVALID_MODEL_OBJECT, null, mapelem);

        else if (elem instanceof vertex) {
            return elem.spatialGroup.layerGroup;
        } else if (elem.superGroup) {
            return elem.superGroup.controlGroup;
        }

        return null;
    }

    /**
 *
 * @private
 * @param {controlGroup | spatialGroup | point} elem
 */
    addToDerivedParent(elem) {
        elem.parent = this.deriveParent(elem);
        elem.layer.addTo(elem.parent ? elem.parent.layer : this.map);
        if (elem instanceof controlGroup) {
            var container;
            if (elem.parent) {
                container = elem.parent.children = elem.parent.children || [];
            } else {
                container = this.overlayTree;
            }
            container.push(elem);
        }
    }

    /**
     * @private
     * @param {controlGroup} cg
     */
    removeFromParentControlGroup(cg) {
        if (cg.parent) {
            let containerArray = cg.parent.children;
            let index = containerArray.indexOf(cg);
            if (index !== -1) {
                containerArray.splice(index, 1);
            }
            if (cg.parent.children.length === 0) {
                delete cg.parent.children;
            }
        } else {
            let containerArray = this.overlayTree;
            let index = containerArray.indexOf(cg);
            if (index !== -1) {
                containerArray.splice(index, 1);
            }
        }
        cg.parent = null;
    }

    /**
 * @private
 * @param {controlGroup | spatialGroup | point | line} elem
 */
    removeFromParent(elem) {
        if (elem.parent != null) {
            elem.parent.layer.removeLayer(elem.layer);
        }
        if (elem instanceof controlGroup) { // parent can be null if it is overlayTree
            this.removeFromParentControlGroup(elem);
        }

        elem.parent = null;
    }

    /**
     *
     * @param {temporalGroup} g
     * @returns {controlGroup}
     */
    createControlGroup(g) {
        if (g.controlGroup != null)
            return g.controlGroup;

        var cg = new controlGroup(g);
        this.addToDerivedParent(cg);
        this.updateLayerTree();
        this.layers.set(cg.layer, cg);
        this.emit(cg, this.CREATE);
        return cg;
    }

    /**
     *
     * @param {spatialGroup} g
     * @returns {layerGroup}
     */
    createLayerGroup(g) {
        if (g.layerGroup != null)
            return g.layerGroup;

        var lg = new layerGroup(g);
        //       this.addToDerivedParent(lg);
        this.layers.set(lg.layer, lg);
        this.emit(lg, this.CREATE);

        return lg;
    }

    /**
     * 
     * @param {vertex} v
    * @returns {point}
     */
    createPoint(v, config = {}) {
        if (v.point != null)
            return v.point;

        var type = config.type || v.type;
        var cfg = this.config.point[type];
        if (cfg && platform.mobile && this.config.mobileRadius)
            cfg.radius = this.config.mobileRadius;
        let p = new point(v, type, cfg);

        let self = this;

        //listen to events
        p.addEventListener('click', (event) =>
            self.emit(event.target, self.CLICK));

        if (this.config.point[type].draggable) {
            p.addEventListener('dragstart', (event) => {
                /** @type {point}*/
                let p = event.target;
                self.startUpdate(p, p.COORDINATES);
            });

            p.addEventListener('drag', (event) => {
                /** @type {point}*/
                let p = event.target;
                p.vertex.forEach(self.updateLineCoordinates.bind(self));
                self.emit(event.target, self.DRAG);
            });

            p.addEventListener('dragend', (event) =>
                self.endUpdate(p, p.COORDINATES));
        }
        let id = v.id;
        p.addEventListener('add', event => {
            p.vertex.forEach(e => {
                if (e.line && e.to.point && this.isVisible(e.to.point)) {
                    e.line.layer.addTo(this.lineGroup);
                    if (e.line.layer._map)
                        e.line.layer.bringToBack();
                }
            });
        });

        p.addEventListener('remove', event => {
            p.vertex.forEach(e => {
                if (e.line)
                    this.lineGroup.removeLayer(e.line.layer);
            });
        });

        this.addToDerivedParent(p); // trigger add event handler
        this.layers.set(p.layer, p);

        if (p.layer.bringToFront != null)
            p.layer.bringToFront();


        this.emit(p, this.CREATE);
        return p;
    }

    /**
     * 
     * @param {edge} e
    * @returns {line}
     */
    createLine(e, config = {}) {
        if (e.line != null)
            return e.line;

        if (e.type === edge.prototype.TEMPORAL)
            return null;

        var type = config.type || e.type;
        if (type === edge.prototype.TEMP)
            type = line.prototype.EDIT;

        let self = this;
        let l = new line(e, type, this.config.line[type]);
        this.layers.set(l.layer, l);

        if (e.from.point && e.to.point &&
            this.isVisible(e.from.point) && this.isVisible(e.to.point))
            l.layer.addTo(this.lineGroup);

        if (l.layer.bringToBack != null)
            l.layer.bringToBack();

        if (l.type === line.prototype.EDIT || l.type === line.prototype.LANDMARK) {
            l.addEventListener('click', (event) =>
                self.emit(event.target, self.CLICK));
        }

        this.emit(l, this.CREATE);
        return l;
    }

    /**
     *
     * @param {spatialGroup} g
     * @returns {layerGroup}
     */
    showLayerGroup(g) {
        if (g.layerGroup == null)
            this.createLayerGroup(g);

        this.addToDerivedParent(g.layerGroup);

        // globally done on map
        //        this.emit( g.layerGroup, this.SHOW);
        return g.layerGroup;
    }

    /**
 *
 * @param {spatialGroup} g
 * @returns {layerGroup}
 */
    hideLayerGroup(g) {
        if (g.layerGroup == null)
            return;

        this.removeFromParent(g.layerGroup);

        // globally done on map
        //        this.emit( g.layerGroup, this.HIDE);

        return g.layerGroup;
    }

    /**
     * @private
     * @param {vertex} fix
    * @returns {function(vertex,vertex) : number}
     */
    distanceComp(fix) {
        return (left, right) => {
            return this.map.distance(left.coordinates, fix.coordinates) - this.map.distance(right.coordinates, fix.coordinates);
        };
    }

    /**
     * 
     * @param {vertex} v
    * @returns {point}
     */
    updatePointCoordinates(v) {
        if (v.point == null)
            return;

        var coordinates = v.point.getCoordinates();
        if (!recursiveCompare(v.coordinates, coordinates)) {

            this.startUpdate(v.point, v.point.COORDINATES);
            v.point.setCoordinates(v.coordinates);
            this.endUpdate(v.point, v.point.COORDINATES);

            v.forEach(e => this.updateLineCoordinates(e));
        }

        return v.point;
    }

    /**
     * 
     * @param {edge} e
    * @returns {line}
     */
    updateLineCoordinates(e) {
        if (e.line == null)
            return e.line;

        let targetCoords = [e.from.point.getCoordinates(), e.to.point.getCoordinates()];
        if (!recursiveCompare(e.line.getCoordinates(), targetCoords)) {
            e.line.setCoordinates(targetCoords);
        }

        return e.line;
    }

    /**
     * 
     * @param {vertex | edge} elem
     */
    setEditable(elem) {
        if (elem instanceof vertex) { // show point if not visible
            if (elem.point && elem.point.type === point.prototype.EDIT)
                return elem.point;
            this.deletePoint(elem);
            var p = this.createPoint(elem, { type: point.prototype.EDIT });
            elem.forEach(e => this.createLine(e));
            return p;
        } else if (elem instanceof edge && elem.line && elem.line.edge === elem
            && elem.type !== edge.prototype.LANDMARK && elem.line.type !== line.prototype.EDIT) {
            this.deleteLine(elem);
            return this.createLine(elem, { type: line.prototype.EDIT });
        }
    }

    /**
     * 
     * @param {edge | vertex} e
     */
    unsetEditable(elem) {
        if (elem instanceof vertex && elem.point) {
            this.deletePoint(elem);
            var p = this.createPoint(elem);
            elem.forEach(e => this.createLine(e));
            return p;
        } else if (elem instanceof edge && elem.line && elem.line.edge === elem && elem.type !== edge.prototype.LANDMARK) {
            this.deleteLine(elem);
            return this.createLine(elem);
        }
    }

    /**
     *
     * @param {vertex | edge | spatialGroup | temporalGroup} elem
     * @returns {point | line | layerGroup | controlGroup}
     */
    updateParent(elem) {
        var mapelem = elem.line || elem.point || elem.layerGroup || elem.controlGroup;

        if (mapelem.parent === this.deriveParent(mapelem))
            return mapelem;

        this.startUpdate(mapelem, mapViewer.LAYER);
        this.removeFromParent(mapelem);
        this.addToDerivedParent(mapelem);
        this.updateLayerTree();

        this.endUpdate(mapelem, mapViewer.LAYER);
        return mapelem;
    }

    /**
*
* @param {temporalGroup} g
*/
    deleteControlGroup(g) {
        if (g.controlGroup == null)
            return;

        this.removeFromParent(g.controlGroup);
        g.controlGroup.layer.remove();
        this.layers.delete(g.controlGroup.layer);
        var elem = g.controlGroup;
        delete g.controlGroup;

        this.emit(elem, this.DELETE);
    }

    /**
*
* @param {spatialGroup} g
*/
    deleteLayerGroup(g) {
        if (g.layerGroup == null)
            return;

        this.removeFromParent(g.layerGroup);
        g.layerGroup.layer.remove();
        this.layers.delete(g.layerGroup.layer);
        var elem = g.layerGroup;
        delete g.layerGroup;

        this.emit(elem, this.DELETE);
    }

    /**
     *
     * @param {vertex} v
     */
    deletePoint(v) {
        if (v.point == null)
            return;

        let elem = v.point;
        v.forEach(e => this.deleteLine(e));
        this.removeFromParent(elem);
        elem.layer.remove();
        this.layers.delete(elem.layer);
        delete elem.layer;
        //        elem.getConnectedLines().forEach(this.deleteLine.bind(this));
        delete v.point;

        this.emit(elem, this.DELETE);
    }

    /**
     *
     * @param {edge} e
     */
    deleteLine(e) {
        if (e.line == null)
            return;

        let elem = e.line;
        if (elem.layer) { // false when opposite edge is handeled
            this.lineGroup.removeLayer(elem.layer);
            elem.layer.remove();
            this.layers.delete(elem.layer);
            delete elem.layer;
        }
        delete e.line;
        if (e.opposite != null)
            delete e.opposite.line;

        this.emit(elem, this.DELETE);
    }

    /**
     * 
     * @param {[number]} coords
     * @param {number} zoom
     */
    setView(coords, zoom) {
        if (this.moveTarget) {
            this.map.setView(coords || this.moveTarget.center, zoom || this.moveTarget.zoom);
        } else {
            this.moveTarget = {
                center: coords || this.getCenter(),
                zoom: zoom || this.getZoom()
            }
            this.map.setView(this.moveTarget.center, this.moveTarget.zoom);
        }
    }

    /**
     * Redraw element
     * */
    invalidateSize() {
        this.map.invalidateSize();
    }

    /**
     * Refresh layer tree
     * */
    updateLayerTree() {
        this.layerControl.setOverlayTree(this.overlayTree).collapseTree(true).expandSelected(true);
    }
}

mapViewer.prototype.CLICK = 'click';
mapViewer.prototype.DRAG = 'drag';
mapViewer.prototype.SHOW = 'show';
mapViewer.prototype.HIDE = 'hide';
mapViewer.prototype.CREATE = 'create';
mapViewer.prototype.DELETE = 'delete';
mapViewer.prototype.GPS = 'gps';
mapViewer.prototype.COORDINATES = 'coordinates';
mapViewer.prototype.ERROR.INVALID_MODEL_OBJECT = 'invalid model object';
mapViewer.prototype.ERROR.UNDEFINED_NAMESPACE = 'undefined namespace';

// utility functions

function latLngToCoords(latlng) {
    return [latlng.lat, latlng.lng];
}

function latLngsToCoords(latlngs) {
    var coords = [];
    for (let latlng of latlngs) {
        coords.push(latLngToCoords(latlng));
    }
    return coords;
}

function coordsToLatLngs(coords) {
    var latlngs = [];
    for (let coord of coords) {
        latlngs.push(coordsToLatLng(coord));
    }
    return latlngs;
}

function coordsToLatLng(coords) {
    return { lat: coords[0], lng: coords[1] };
}