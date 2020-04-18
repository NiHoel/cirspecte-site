'use strict';

/**
 * Classes: item, group, timelineViewer
 * 
 * Usage:
 * Call create*, delete* and update* on an instance of the timelineViewer class to manipulate
 * items and groups.
 * 
 * Implementation details:
 * Interface to timeline.
 * Selected items need to be tracked internally 
 * since clicking on the timeline normally deselects all
 * */

///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: item
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of a spatialGroup on the timeline.
 * */
class item {
    get [Symbol.toStringTag]() {
        return 'Timeline Item';
    }

    /**
     * 
     * @param {spatialGroup} g
     */
    constructor(g) {
        this.group = g.superGroup.id;
        this.id = g.id;
        this.title = g.description;
        this.content = g.name;
        this.start = g.timeslot;

        this.spatialGroup = g;
        g.item = this;
    }
}


///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: rangeItem
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of a collection of spatialGroups on the timeline.
 * */
class rangeItem {
    get [Symbol.toStringTag]() {
        return 'Timeline Range Item';
    }

    /**
     * 
     * @param {[item]} items
     */
    constructor(items) {
        this.items = items;// = items.sort((a, b) => b.start - a.end);
        let lastItem = items[items.length - 1];
        this.group = items[0].group;
        this.id = items[0].id + "-" + lastItem.id;
        let text = items[0].content + " - " + lastItem.content;
        this.title = text;
        this.content = text;
        this.start = items[0].start;
        this.end = lastItem.start;
        this.type = "range"
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: group
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Visual representation of a temporalGroup on the timeline.
 * */
class group {
    get [Symbol.toStringTag]() {
        return 'Timeline Group';
    }

    /**
     *
     * @param {temporalGroup | group} g
     */
    constructor(g) {
        this.id = g.id;
        this.title = g.title || g.description;
        this.content = g.content || g.name;
        this.nestedGroups = g.nestedGroups;
        this.treeLevel = g.treeLevel || g.getDepth() + 1;

        if (g.superGroup) {
            let supergr = g.superGroup.group;
            this.nestedInGroup = supergr.id;
            if (!supergr.nestedGroups)
                supergr.nestedGroups = [this.id];
            else
                supergr.nestedGroups.push(this.id);
        }

        g.group = this;
        this.temporalGroup = g;
    }

    /**
*
* @param {function(group) : void} f
*/
    forEach(f) {
        Array.from(this.nestedGroups || []).forEach(f);
    }

    /**
     * @returns {Rx.Observable<group>}
     */
    toObservable() {
        return Rx.Observable.from(Array.from(this.nestedGroups || []));
    }
}


///////////////////////////////////////////////////////////////////////////////////////////////////
//
//    Class: timelineViewer
//
///////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Listen to events: this.observe(<class>, <action>).subscribe(elem => / do something with element here /)
 * where <class> in {item, group}
 * <action> in {this.CREATE, this.DELETE, this.SELECT, this.DESELECT, this.CLICK}
 * special combinations (this.VALUE, this.HEIGHTUPDATE)
 * */
class timelineViewer extends observable {
    get [Symbol.toStringTag]() {
        return 'Timeline Viewer';
    }

    /**
     * 
     * @param {HTMLElement | string} domElement
     * @param {JSON} config
     */
    constructor(domElement, config = {}, settings) {
        super();
        // DOM element where the Timeline will be attached
        this.domElement = typeof domElement === 'string' ? document.getElementById(domElement) : domElement;

        this.settings = settings;

        this.items = new Map();
        this.groups = new Map();
        this.start = new Date();
        this.end = new Date();
        this.width = 0; 

        this.selections = new Map();

        var self = this;

        // Configuration for the Timeline
        config.multiselect = config.multiselect || true;

        config.onRemove = function (item, callback) {
            item = Object.assign(item.spatialGroup.item, item);
            delete item.spatialGroup.item;
            item.userDeleted = true; // starts a new undo routine
            self.emit(item, self.DELETE);
            callback(item);
        };
        //        config.dataAttributes = 'all';

        this.config = config;

        // Create a Timeline
        this.timeline = new timeline.Timeline(this.domElement, [], Array.from(this.groups.values()), this.config);



        this.timeline.on('select', prop => prop.items.forEach(i => {
            //var it = this.getItem(i);
            //if(this.isSelected(it)){
            //    this.selections.delete(it.id);
            //    this.emit( it, this.DESELECT);
            //} else {
            //    this.selections.set(it.id, it);
            //    this.emit( it, this.SELECT);
            //}
            //this.refreshItems();
            let item = this.getItem(i);
            if (item) {
                this.toggleSelection(item);
                this.emit(item, this.CLICK);
            }
        }));

        this.timeline.on('click', prop => {
            if(prop.group){
                this.emit(this.getGroup(prop.group), this.CLICK);
            }
            this.refreshSelections();
        })

        //Emit changes of the height to update the document layout
        this.height = $(this.domElement).height();

        var heightChangeCheck = () => {
            var height = $(this.domElement).height();
            if (this.height != height) {
                this.height = height;
                this.emit(height, this.HEIGHTUPDATE, this.VALUE);
            }
        }
        this.timeline.on('changed', heightChangeCheck);
        this.timeline.on('currentTimeTick', heightChangeCheck);

        this.timeline.on('rangechanged', () => this.refreshItems());
        this.timeline.on('timechanged', () => this.refreshItems());
        this.timeline.on('currentTimeTick', () => this.refreshItems());

        /*        // Update range items 
                this.duration = this.getEnd() - this.getStart();
                this.timeline.on('rangechanged', ev => {
                    if(ev.end - ev.start != this.duration){
                        this.duration = ev.end - ev.start;
                        this.showFullItemStack = true;
                    }
                })
        */

        // Listen when values in configurator change
        settings.aggregateItems.subscribe(val => {
            this.refreshItems(true);
        })
        settings.timeline.start.subscribe(val => {
            if (val)
                this.timeline.setOptions({ start: val });
        });
        settings.timeline.end.subscribe(val => {
            if (val)
                this.timeline.setOptions({ end: val });
        });
        settings.timeline.min.subscribe(val => this.timeline.setOptions({ min: val }));
        settings.timeline.max.subscribe(val => this.timeline.setOptions({ max: val }));
        settings.timeline.selections.subscribe(val => {
            var selections = new Set(val); // set of ids
            //deselect appropriate items
            this.selections.forEach(i => {
                if (!selections.has(i.id))
                    this.toggleSelection(i, false);
            });
            selections.forEach(i => this.toggleSelection(this.getItem(i), true));
        });
    }

    /**
     * 
     * @param {string} g
     * @returns {group}
     */
    getGroup(g) {
        return this.groups.get(g);
    }

    /**
 * 
 * @param {string} i
 * @returns {item}
 */
    getItem(i) {
        return this.items.get(i);
    }

    /**
     * @returns {Date} - left most displayed date on the timeline
     * */
    getStart() {
        return this.timeline.getWindow().start;
    }

    /**
     * @returns {Date} - right most displayed date on the timeline
     * */
    getEnd() {
        return this.timeline.getWindow().end;
    }

    /**
     * @returns {[item]}
     * */
    getSelections() {
        return Array.from(this.selections.values());
    }

    /**
     * @returns {[string]}
     * */
    getSelectionsIds() {
        return Array.from(this.selections.keys());
    }

    /**
     * 
     * @param {spatialGroup} g
     * @returns {item}
     */
    createItem(g) {
        if (this.items.has(g.id))
            return this.items.get(g.id);
        var it = new item(g);

        this.items.set(it.id, it);
        setTimeout(this.refreshItems.bind(this), 0);

        this.emit(it, this.CREATE);

        var selections = new Set(this.settings.getTimelineOptions().selections);
        if (selections.has(it.id))
            this.toggleSelection(it, true);
    }

    /**
     *
     * @param {temporalGroup} g
     * @returns {group}
     */
    createGroup(g) {
        if (this.groups.has(g.id))
            return this.groups.get(g.id);

        var gr = new group(g);
        this.groups.set(gr.id, gr);

        this.refreshGroups();
        this.emit(gr, this.CREATE);
    }

    /**
     *
     * @param {spatialGroup} g
     */
    updateItem(g) {

        if (g.item.group !== g.superGroup.id) {
            g.item.group = g.superGroup.id;
            this.timeline.setItems(Array.from(this.items.values()));
            this.refreshItems(true);
            //           this.emit( g.item, this.GROUPUPDATE);
        }

    }

    /**
    * @param {item} i
    * @param {boolean} [select]
    */
    toggleSelection(i, select) {
        if (i == null)
            return;

        if (select == null)
            select = !this.isSelected(i);

        var update = false;
        if (select) {
            if (!this.isSelected(i)) {
                // deselect others
                if (i.spatialGroup.superGroup && !i.spatialGroup.isMultiselect())
                    i.spatialGroup.superGroup.forEach(sg => {
                        if (sg.item && this.selections.has(sg.item.id)) {
                            this.selections.delete(sg.item.id);
                            this.emit(sg.item, this.DESELECT);
                        }
                    });

                this.selections.set(i.id, i);
                update = true;
                this.emit(i, this.SELECT);
            }
        } else {
            update = this.selections.delete(i.id);
            if (update)
                this.emit(i, this.DESELECT);
        }

        if (update) {
            this.refreshSelections();
        }

        return i;
    }

    /**
    * @param {item} i
    * @returns {boolean}
    */
    isSelected(i) {
        if (i == null)
            return false;
        return this.selections.has(i.id);
    }

    /**
     *
     * @param {temporalGroup} g
     */
    deleteGroup(g) {
        if (this.groups.delete(g.id)) {
            if (g.group.nestedGroups) {
                g.group.nestedGroups.forEach(this.deleteGroup.bind(this));
            }
            for (let it of this.items.values()) {
                if (it.group === g.id)
                    this.deleteItem(it.spatialGroup);
            }
            if (g.superGroup && g.superGroup.group) {
                var nestedGroups = g.superGroup.group.nestedGroups || [];
                let index = nestedGroups.findIndex(elem => elem === g.id);
                if (index !== -1) {
                    nestedGroups.splice(index, 1);
                }
            }
            var gr = g.group;
            delete g.group;
            this.refreshGroups();
            this.emit(gr, this.DELETE);
        }
    }

    /**
 *
 * @param {spatialGroup} g
 */
    deleteItem(g) {
        if (this.items.delete(g.id) && g.item) {
            this.toggleSelection(g.item, false);
            var it = g.item;
            delete g.item;
            this.refreshItems(true);
            this.emit(it, this.DELETE);
        }
    }

    refreshSelections() {
        this.timeline.setSelection(Array.from(this.selections.keys()));
    }

    refreshItems(force = false) {
        
        let width = $(this.timeline.body.dom.backgroundVertical).width();
        let window = this.timeline.getWindow();
        let millisecondsPerPixel = this.timeline.range.millisecondsPerPixelCache
            || (window.end - window.start) / width;
        let itemWidth = 160;
        let criticalDuration = millisecondsPerPixel * itemWidth / 2;
        
        let start = new Date(window.start - (itemWidth * millisecondsPerPixel));
        let end = window.end;

        if (!force && width == this.width
            && moment(start).isSame(moment(this.start))
            && moment(end).isSame(moment(this.end)))
            return;

        this.width = width;
        this.start = start;
        this.end = end;

        if (this.settings.aggregateItems()) {
            var visibleItems = new Set();
            var items = [];

            for (var item of this.items.values()) {
                if (item && start <= item.start && item.start <= end)
                    visibleItems.add(item);
            }

            var processArray = (itemArray) => {
                if (itemArray.length == 0) {
                    return;
                } else if (itemArray.length == 1) {
                    items.push(itemArray[0]);

                } else if (itemArray.length == 2) {
                    items.push(itemArray[0]);
                    items.push(itemArray[1]);
                } else {
                    items.push(new rangeItem(itemArray));

                }
            }

            for (var group of this.groups.values()) {
                var groupItems = [];
                group.temporalGroup.forEach(g => {
                    var i = this.getItem(g.id);
                    if (i && visibleItems.has(i))
                        groupItems.push(i);
                });


                groupItems.sort((a, b) => a.start - b.start);

                var itemArray = [];
                var latestStart = null;
                for (var i of groupItems) {
                    if (latestStart) {
                        if (i.start - latestStart < criticalDuration) {
                            itemArray.push(i);
                        } else {
                            processArray(itemArray);
                            itemArray = [i];
                        }
                    } else {
                        itemArray[0] = i;
                    }
                    latestStart = i.start;
                }

                processArray(itemArray);
            }

            this.timeline.setItems(new timeline.DataSet(items));
        } else {
            this.timeline.setItems(new timeline.DataSet(Array.from(this.items.values())));
        }
        this.refreshSelections();
    }

    refreshGroups() {
        this.timeline.setGroups(new timeline.DataSet(Array.from(this.groups.values())));
    }

    /**
     * Redraw element
     * */
    invalidateSize() {
        this.refreshSelections();
        this.timeline.redraw();
    }
}

timelineViewer.prototype.CREATE = 'create';
timelineViewer.prototype.DELETE = 'delete';
timelineViewer.prototype.CLICK = 'click';
timelineViewer.prototype.SELECT = 'select';
timelineViewer.prototype.DESELECT = 'deselect';
timelineViewer.prototype.HEIGHTUPDATE = 'update height';
timelineViewer.prototype.VALUE = 'value';