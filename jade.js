// Copyright (C) 2011-2013 Massachusetts Institute of Technology
// Chris Terman

// JADE: JAvascript Design Envrionment

// Model:
//  libraries: object with Library attributes
//  Library: object with Module attributes
//  Module: [ object with Aspect attributes, object with Propery attributes ]
//  Property: object with the following attributes: type, label, value, edit, choices
//  Aspect: list of Components, support for ConnectionPoints, undo/reo
//  Component: list of [type coords { property: value... }]
//  coords: list of position/dimension params (x, y, rotation)...

// View/Controller:
//  Editor -- library management toolbar, tabbed display of aspect editors, status
//  Aspect editors (Schematic, Icon, ...) -- toolbar, diagram, parts bin if appropriate
//  Toolbar -- object with Tool attributes, support for adding, enabling, disabling tools
//  Diagram -- view for editing a given Aspect, support for editing gestures, pop-up windows
//  PartsBin -- view for selecting library/module to include as instance

$(document).ready(function() {
    // look for nodes of class "diagram" and give them an editor
    $('.jade').each(function(index, node) {
        if (node.jade === undefined) new jade.Jade(node);
    });
});

var jade = (function() {
    var exports = {};

    //////////////////////////////////////////////////////////////////////
    //
    // Libraries
    //
    //////////////////////////////////////////////////////////////////////

    var libraries = {}; // attributes are Library objects
    exports.libraries = libraries;

    function Library(name, json) {
        this.name = name;
        this.modules = {}; // attributes are Module objects
        this.modified = true; // new libaries count as modified

        if (json) this.load(json);
    }

    // initialize library from JSON object
    Library.prototype.load = function(json) {
        // note that modules may have already been created because they've
        // been referenced as a component is some other library.
        for (var m in json) {
            this.module(m).load(json[m]);
        }
        this.modified = false; // newly loaded libraries are unmodified
    };

    // return specified Module, newly created if necessary
    Library.prototype.module = function(name) {
        var module = this.modules[name];
        if (module === undefined) {
            module = new Module(name, this);
            this.modules[name] = module;
            this.set_modified(true);
        }
        return module;
    };

    // produce JSON representation of a library
    Library.prototype.json = function() {
        // weed out empty modules
        var json = {};
        for (var m in this.modules) {
            var module = this.modules[m].json();
            if (module) json[m] = module;
        }
        return json;
    };

    Library.prototype.set_modified = function(which) {
        if (which != this.modified) {
            this.modified = which;
            //if (which) console.log('library modified: '+this.name);
        }
    };

    // if necessary save library to server
    Library.prototype.save = function() {
        if (this.modified) {
            var lib = this; // for closure
            var args = {
                url: 'server.cgi',
                type: 'POST',
                data: {
                    file: this.name,
                    json: JSON.stringify(this.json())
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    alert(errorThrown);
                },
                success: function() {
                    // clear modified status for library and its modules
                    for (var m in this.modules) {
                        this.modules[m].set_modified(false);
                    }
                    lib.set_modified(false);
                }
            };
            $.ajax(args);
        }
    };

    // update server with any changes to loaded libraries
    function save_libraries() {
        for (var l in libraries) {
            libraries[l].save();
        }
    }

    // return specified Module, newly created if necessary. Module names have
    // the form library:module.  This function will contact server to load needed
    // library.
    function find_module(name) {
        var parse = name.split(':');
        var lname, mname;
        if (parse.length == 1) {
            lname = 'user';
            mname = parse[0];
        }
        else if (parse.length == 2) {
            lname = parse[0];
            mname = parse[1];
        }
        else return undefined;

        if (!(lname in libraries)) {
            // allocate new library, add to list so we know we're loading it
            var lib = new Library(lname);
            libraries[lname] = lib;

            // get contents from the server
            var args = {
                async: false, // hang until load completes
                url: 'server.cgi',
                type: 'GET',
                data: {
                    file: lname
                },
                dataType: 'json',
                error: function(jqXHR, textStatus, errorThrown) {
                    alert(errorThrown);
                },
                success: function(json) {
                    // server always returns legit JSON, even if
                    // it's just {} for a new library.
                    lib.load(json);
                }
            };
            $.ajax(args);
        }
        return libraries[lname].module(mname);
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Modules
    //
    //////////////////////////////////////////////////////////////////////

    function Module(name, lib, json) {
        this.library = lib;
        this.name = name;
        this.aspects = {};
        this.properties = {};
        this.set_modified(true);

        // list of callbacks when load is complete
        this.loaded = false;
        this.listeners = [];

        if (json) this.load(json);
    }

    Module.prototype.add_listener = function(callback) {
        // if we're already loaded, do callback now
        if (this.loaded) callback('load');
        else this.listeners.push(callback);
    };

    Module.prototype.set_modified = function(which) {
        if (this.modified != which) {
            this.modifed = which;
            if (which) this.library.set_modified(true);
            //if (which) console.log('module modified: '+this.library.name+':'+this.name);
        }
    };

    Module.prototype.set_property = function(prop, v) {
        this.properties[prop] = v;
        this.set_modified(true);
    };

    Module.prototype.remove_property = function(prop) {
        if (prop in this.properties) {
            delete this.properties[prop];
            this.set_modified(true);
        }
    };

    // initialize module from JSON object
    Module.prototype.load = function(json) {
        // load aspects
        for (var a in json[0]) {
            this.aspects[a] = new Aspect(a, this, json[0][a]);
        }

        // load properties
        this.properties = json[1];

        // a newly loaded module starts as unmodified
        this.set_modified(false);

        this.loaded = true;
        for (var i = this.listeners.length - 1; i >= 0; i -= 1) {
            this.listeners[i]('load');
        }
    };

    Module.prototype.has_aspect = function(name) {
        if (name in this.aspects) return !this.aspects[name].empty();
        return false;
    };

    // return specified aspect, newly created if necessary
    Module.prototype.aspect = function(name) {
        var aspect = this.aspects[name];
        if (aspect === undefined) {
            aspect = new Aspect(name, this);
            this.aspects[name] = aspect;
            this.set_modified(true);
        }
        return aspect;
    };

    // produce JSON representation of a module, undefined if module is empty
    Module.prototype.json = function() {
        // weed out empty aspects
        var aspects;
        for (var a in this.aspects) {
            var json = this.aspects[a].json();
            if (json.length > 0) {
                if (aspects === undefined) aspects = {};
                aspects[a] = json;
            }
        }

        // if module is empty, returned undefined
        if (aspects === undefined && Object.keys(this.properties).length === 0) return undefined;

        return [aspects || {}, this.properties];
    };

    //////////////////////////////////////////////////////////////////////
    //
    // Aspects
    //
    //////////////////////////////////////////////////////////////////////

    function Aspect(name, module, json) {
        this.module = module;
        this.name = name;
        this.components = [];
        this.modified = true;

        this.connection_points = {}; // location string => list of cp's

        // for undo/redo keep a list of actions and the changes that resulted.
        // Each element of the list is a list of changes that happened concurrently,
        // they will all be undone or redone together.  Each change is a list:
        // [component, 'action', params...]
        this.actions = [];
        this.current_action = -1; // index of current list of changes
        this.change_list = undefined;

        if (json) this.load(json);
    }

    // initialize aspect from JSON object
    Aspect.prototype.load = function(json) {
        for (var i = 0; i < json.length; i += 1) {
            var c = make_component(json[i]);
            c.add(this);
        }
        this.modified = false;
    };

    Aspect.prototype.set_modified = function(which) {
        if (which != this.modified) {
            this.modified = which;
            if (which && this.module) this.module.set_modified(which);
            //if (which) console.log('aspect modified: '+this.name+' of '+this.module.library.name+':'+this.module.name);
        }
    };

    Aspect.prototype.json = function() {
        var json = [];
        for (var i = 0; i < this.components.length; i += 1) {
            json.push(this.components[i].json());
        }
        return json;
    };

    Aspect.prototype.empty = function() {
        return this.components.length === 0;
    };

    Aspect.prototype.start_action = function() {
        this.change_list = []; // start recording changes
    };

    Aspect.prototype.end_action = function() {
        if (this.change_list !== undefined && this.change_list.length > 0) {
            this.clean_up_wires(true); // canonicalize diagram's wires
            this.set_modified(true);
            this.current_action += 1;

            // truncate action list at current entry
            if (this.actions.length > this.current_action) this.actions = this.actions.slice(0, this.current_action);

            this.actions.push(this.change_list);
        }
        this.change_list = undefined; // stop recording changes
    };

    Aspect.prototype.add_change = function(change) {
        if (this.change_list !== undefined) this.change_list.push(change);
    };

    Aspect.prototype.can_undo = function() {
        return this.current_action >= 0;
    };

    Aspect.prototype.undo = function() {
        if (this.current_action >= 0) {
            var changes = this.actions[this.current_action];
            this.current_action -= 1;
            // undo changes in reverse order
            for (var i = changes.length - 1; i >= 0; i -= 1) {
                changes[i](this, 'undo');
            }
            this.clean_up_wires(false); // canonicalize diagram's wires
        }

        this.set_modified(this.current_action == -1);
    };

    Aspect.prototype.can_redo = function() {
        return this.current_action + 1 < this.actions.length;
    };

    Aspect.prototype.redo = function() {
        if (this.current_action + 1 < this.actions.length) {
            this.current_action += 1;
            var changes = this.actions[this.current_action];
            // redo changes in original order
            for (var i = 0; i < changes.length; i += 1) {
                changes[i](this, 'redo');
            }
            this.clean_up_wires(false); // canonicalize diagram's wires
            this.changed = true;
        }
    };

    Aspect.prototype.add_component = function(new_c) {
        this.components.push(new_c);
    };

    Aspect.prototype.remove_component = function(c) {
        var index = this.components.indexOf(c);
        if (index != -1) {
            this.components.splice(index, 1);
        }
    };

    Aspect.prototype.map_over_components = function(f) {
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            if (f(this.components[i], i)) return;
        }
    };

    Aspect.prototype.selections = function() {
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            if (this.components[i].selected) return true;
        }
        return false;
    };

    // returns component if there's exactly one selected, else undefined
    Aspect.prototype.selected_component = function() {
        var selected;
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            if (this.components[i].selected) {
                if (selected === undefined) selected = this.components[i];
                else return undefined;
            }
        }
        return selected;
    };

    Aspect.prototype.find_connections = function(cp) {
        return this.connection_points[cp.location];
    };

    // add connection point to list of connection points at that location
    Aspect.prototype.add_connection_point = function(cp) {
        var cplist = this.connection_points[cp.location];
        if (cplist) cplist.push(cp);
        else {
            cplist = [cp];
            this.connection_points[cp.location] = cplist;
        }

        // return list of conincident connection points
        return cplist;
    };

    // remove connection point from the list points at the old location
    Aspect.prototype.remove_connection_point = function(cp, old_location) {
        // remove cp from list at old location
        var cplist = this.connection_points[old_location];
        if (cplist) {
            var index = cplist.indexOf(cp);
            if (index != -1) {
                cplist.splice(index, 1);
                // if no more connections at this location, remove
                // entry from array to keep our search time short
                if (cplist.length === 0) delete this.connection_points[old_location];
            }
        }
    };

    // connection point has changed location: remove, then add
    Aspect.prototype.update_connection_point = function(cp, old_location) {
        this.remove_connection_point(cp, old_location);
        return this.add_connection_point(cp);
    };

    // add a wire to the diagram
    Aspect.prototype.add_wire = function(x1, y1, x2, y2, rot) {
        var new_wire = make_component(['wire', [x1, y1, rot, x2 - x1, y2 - y1]]);
        new_wire.add(this);
        return new_wire;
    };

    Aspect.prototype.split_wire = function(w, cp) {
        // remove bisected wire
        w.remove();

        // add two new wires with connection point cp in the middle
        this.add_wire(w.coords[0], w.coords[1], cp.x, cp.y, 0);
        var far_end = w.far_end();
        this.add_wire(far_end[0], far_end[1], cp.x, cp.y, 0);
    };

    // see if connection points of component c split any wires
    Aspect.prototype.check_wires = function(c) {
        for (var i = 0; i < this.components.length; i += 1) {
            var cc = this.components[i];
            if (cc != c) { // don't check a component against itself
                // only wires will return non-null from a bisect call
                var cp = cc.bisect(c);
                if (cp) {
                    // cc is a wire bisected by connection point cp
                    this.split_wire(cc, cp);
                }
            }
        }
    };

    // see if there are any existing connection points that bisect wire w
    Aspect.prototype.check_connection_points = function(w) {
        for (var locn in this.connection_points) {
            var cplist = this.connection_points[locn];
            if (cplist && w.bisect_cp(cplist[0])) {
                this.split_wire(w, cplist[0]);
                // stop here, new wires introduced by split will do their own checks
                return;
            }
        }
    };

    // merge collinear wires sharing an end point.
    Aspect.prototype.clean_up_wires = function() {
        // merge colinear wires
        for (var locn in this.connection_points) {
            var cplist = this.connection_points[locn];
            if (cplist && cplist.length == 2) {
                // found a connection with just two connections, see if they're wires
                var c1 = cplist[0].parent;
                var c2 = cplist[1].parent;
                if (c1.type == 'wire' && c2.type == 'wire') {
                    var e1 = c1.other_end(cplist[0]);
                    var e2 = c2.other_end(cplist[1]);
                    var e3 = cplist[0]; // point shared by the two wires
                    if (collinear(e1, e2, e3)) {
                        c1.remove();
                        c2.remove();
                        this.add_wire(e1.x, e1.y, e2.x, e2.y, 0);
                    }
                }
            }
        }

        // remove redundant wires
        while (this.remove_redundant_wires());
    };

    // elminate wires between the same end points.  Keep calling until it returns false.
    Aspect.prototype.remove_redundant_wires = function() {
        for (var locn in this.connection_points) {
            var cplist = this.connection_points[locn];
            for (var i = 0; i < cplist.length; i += 1) {
                var cp1 = cplist[i];
                var w1 = cp1.parent;
                if (w1.type == 'wire') {
                    var cp2 = w1.other_end(cp1);
                    for (var j = i + 1; j < cplist.length; j += 1) {
                        var w2 = cplist[j].parent;
                        if (w2.type == 'wire' && w2.other_end(cp1).coincident(cp2.x, cp2.y)) {
                            // circumvent unnecessary wire removal search
                            Component.prototype.remove.call(w2);
                            // we've modified lists we're iterating over, so to avoid
                            // confusion, start over
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    };

    Aspect.prototype.selections = function() {
        var selections = false;
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            if (this.components[i].selected) selections = true;
        }
        return selections;
    };

    Aspect.prototype.compute_bbox = function(initial_bbox, selected, unselected) {
        // compute bounding box for selection
        var min_x = (initial_bbox === undefined) ? Infinity : initial_bbox[0];
        var max_x = (initial_bbox === undefined) ? -Infinity : initial_bbox[2];
        var min_y = (initial_bbox === undefined) ? Infinity : initial_bbox[1];
        var max_y = (initial_bbox === undefined) ? -Infinity : initial_bbox[3];
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            var component = this.components[i];
            if (selected && !component.selected) continue;
            if (unselected && component.selected) continue;
            if (component.type == 'property') continue;

            min_x = Math.min(component.bbox[0], min_x);
            max_x = Math.max(component.bbox[2], max_x);
            min_y = Math.min(component.bbox[1], min_y);
            max_y = Math.max(component.bbox[3], max_y);
        }
        return [min_x, min_y, max_x, max_y];
    };

    Aspect.prototype.unselected_bbox = function(initial_bbox) {
        return this.compute_bbox(initial_bbox, false, true);
    };

    Aspect.prototype.selected_bbox = function(initial_bbox) {
        return this.compute_bbox(initial_bbox, true, false);
    };

    Aspect.prototype.selected_grid = function() {
        var grid = 1;
        for (var i = this.components.length - 1; i >= 0; i -= 1) {
            var c = this.components[i];
            if (c.selected) grid = Math.max(grid, c.required_grid);
        }
        return grid;
    };

    // label all the nodes in the circuit
    Aspect.prototype.label_connection_points = function(prefix, port_map) {
        var i;
        
        // start by clearing all the connection point labels
        for (i = this.components.length - 1; i >= 0; i -= 1) {
            this.components[i].clear_labels();
        }

        // components are in charge of labeling their unlabeled connections.
        // labels given to connection points will propagate to coincident connection
        // points and across Wires.

        // let special components like GND or named wires label their connection(s)
        for (i = this.components.length - 1; i >= 0; i -= 1) {
            this.components[i].add_default_labels(prefix, port_map);
        }

        // now have components generate labels for unlabeled connections
        this.next_label = 0;
        for (i = this.components.length - 1; i >= 0; i -= 1) {
            this.components[i].label_connections(prefix);
        }
    };

    // generate a new label
    Aspect.prototype.get_next_label = function(prefix) {
        // generate next label in sequence
        this.next_label += 1;
        return prefix + this.next_label.toString();
    };

    // propagate label to coincident connection points
    Aspect.prototype.propagate_label = function(label, location) {
        var cplist = this.connection_points[location];
        for (var i = cplist.length - 1; i >= 0; i -= 1) {
            cplist[i].propagate_label(label);
        }
    };

    Aspect.prototype.ensure_component_names = function(prefix) {
        var i, c, name;

        // first find out what names have been assigned
        var cnames = {}; // keep track of names at this level
        for (i = 0; i < this.components.length; i += 1) {
            c = this.components[i];
            name = c.name;
            if (name) {
                if (name in cnames) throw "Duplicate component name: " + prefix + name;
                cnames[name] = c; // add to our list
            }
        }

        // now create reasonable unique name for unnamed components that have name property
        for (i = 0; i < this.components.length; i += 1) {
            c = this.components[i];
            if (c.module.name === undefined) continue; // filter out built-in components
            name = c.name;
            if (name === '' || name === undefined) {
                var counter = 1;
                while (true) {
                    name = c.module.name.toUpperCase() + '_' + counter.toString();
                    if (!(name in cnames)) break;
                    counter += 1;
                }
                c.name = name; // remember name assignment for next time
                cnames[name] = c; // add to our list
            }
        }
    };

    // mlist is a list of module names "lib:module" that are the leaves
    // of the extraction tree.
    // port_map is an associative array: local_sig => external_sig
    Aspect.prototype.netlist = function(mlist, prefix, port_map) {
        // figure out signal names for all connections
        this.label_connection_points(prefix, port_map);

        // ensure unique names for each component
        this.ensure_component_names(prefix);

        // extract netlist from each component
        var netlist = [];
        for (var i = 0; i < this.components.length; i += 1) {
            var n = this.components[i].netlist(mlist, prefix);
            if (n !== undefined) netlist.push.apply(netlist, n);
        }
        return netlist;
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Rectangle helper functions
    //
    ////////////////////////////////////////////////////////////////////////////////

    // rect is an array of the form [left,top,right,bottom]

    // ensure left < right, top < bottom
    function canonicalize(r) {
        var temp;

        // canonicalize bounding box
        if (r[0] > r[2]) {
            temp = r[0];
            r[0] = r[2];
            r[2] = temp;
        }
        if (r[1] > r[3]) {
            temp = r[1];
            r[1] = r[3];
            r[3] = temp;
        }
    }

    function between(x, x1, x2) {
        return x1 <= x && x <= x2;
    }

    // only works for manhattan rectangles
    function intersect(r1, r2) {
        // look for non-intersection, negate result
        var result = !(r2[0] > r1[2] || r2[2] < r1[0] || r2[1] > r1[3] || r2[3] < r1[1]);

        // if I try to return the above expression, javascript returns undefined!!!
        return result;
    }

    function transform_x(rot, x, y) {
        if (rot === 0 || rot == 6) return x;
        else if (rot == 1 || rot == 5) return -y;
        else if (rot == 2 || rot == 4) return -x;
        else return y;
    }

    function transform_y(rot, x, y) {
        if (rot == 1 || rot == 7) return x;
        else if (rot == 2 || rot == 6) return -y;
        else if (rot == 3 || rot == 5) return -x;
        else return y;
    }

    // result of composing two rotations: orient[old*8 + new]
    var rotate = [
    0, 1, 2, 3, 4, 5, 6, 7, // NORTH (identity)
    1, 2, 3, 0, 7, 4, 5, 6, // EAST (rot270) rotcw
    2, 3, 0, 1, 6, 7, 4, 5, // SOUTH (rot180)
    3, 0, 1, 2, 5, 6, 7, 4, // WEST (rot90) rotccw
    4, 5, 6, 7, 0, 1, 2, 3, // RNORTH (negx) fliph
    5, 6, 7, 4, 3, 0, 1, 2, // REAST (int-neg)
    6, 7, 4, 5, 2, 3, 0, 1, // RSOUTH (negy) flipy
    7, 4, 5, 6, 1, 2, 3, 0 // RWEST (int-pos)
    ];

    //////////////////////////////////////////////////////////////////////
    //
    // Components
    //
    //////////////////////////////////////////////////////////////////////

    var built_in_components = {};
    exports.built_in_components = built_in_components;

    function make_component(json) {
        var c = built_in_components[json[0]];

        if (c) return new c(json);
        else return new Component(json);
    }

    // general-purpose component, drawn in a diagram using its icon
    function Component(json) {
        this.aspect = undefined;
        this.module = undefined;
        this.icon = undefined;

        this.type = undefined;
        this.coords = [0, 0, 0];
        this.properties = {};

        this.selected = false;
        this.bounding_box = [0, 0, 0, 0]; // in device coords [left,top,right,bottom]
        this.bbox = this.bounding_box; // in absolute coords
        this.connections = [];

        if (json) this.load(json);
    }
    exports.Component = Component;
    Component.prototype.required_grid = 8;

    Component.prototype.clone_properties = function(remove_default_values) {
        // weed out empty properties or those that match default value
        var props = {};
        for (var p in this.properties) {
            var v = this.properties[p];
            if (v !== undefined && v !== '' && (!remove_default_values || v != this.module.properties[p].value)) props[p] = v;
        }
        return props;
    };

    Component.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        // track down icon and set up bounding box and connections
        var component = this; // for closure
        this.module = find_module(this.type);
        this.module.add_listener(function() {
            Component.prototype.compute_bbox.call(component);
        });
    };

    Component.prototype.default_properties = function() {
        // update properties from module's default values
        for (var p in this.module.properties) {
            if (!(p in this.properties)) this.properties[p] = this.module.properties[p].value || '';
        }
    };

    Component.prototype.compute_bbox = function() {
        // update properties from module's default values
        this.default_properties();
        this.name = this.properties.name; // used when extracting netlists

        this.icon = this.module.aspect(Icon.prototype.editor_name);
        if (this.icon === undefined) return;

        // look for terminals in the icon and add appropriate connection
        // points for this instance
        var component = this; // for closure
        this.icon.map_over_components(function(c) {
            var cp = c.terminal_coords();
            if (cp) component.add_connection(cp[0], cp[1], cp[2]);
        });

        this.bounding_box = this.icon.compute_bbox();
        this.update_coords();
    };

    // default: no terminal coords to provide!
    Component.prototype.terminal_coords = function() {
        return undefined;
    };

    Component.prototype.json = function() {
        var p = this.clone_properties(true);
        if (Object.keys(p).length > 0) return [this.type, this.coords.slice(0), p];
        else return [this.type, this.coords.slice(0)];
    };

    Component.prototype.clone = function(x, y) {
        var c = make_component(this.json());
        c.coords[0] = x; // override x and y
        c.coords[1] = y;
        return c;
    };

    Component.prototype.set_select = function(which) {
        this.selected = which;
    };

    Component.prototype.add_connection = function(offset_x, offset_y, name) {
        this.connections.push(new ConnectionPoint(this, offset_x, offset_y, name));
    };

    Component.prototype.update_coords = function() {
        var x = this.coords[0];
        var y = this.coords[1];

        // update bbox
        var b = this.bounding_box;
        this.bbox[0] = this.transform_x(b[0], b[1]) + x;
        this.bbox[1] = this.transform_y(b[0], b[1]) + y;
        this.bbox[2] = this.transform_x(b[2], b[3]) + x;
        this.bbox[3] = this.transform_y(b[2], b[3]) + y;
        canonicalize(this.bbox);

        // update connections
        for (var i = this.connections.length - 1; i >= 0; i -= 1) {
            this.connections[i].update_location();
        }
    };

    Component.prototype.inside = function(x, y, rect) {
        if (rect === undefined) rect = this.bbox;
        return between(x, rect[0], rect[2]) && between(y, rect[1], rect[3]);
    };

    // rotate component relative to specified center of rotation
    Component.prototype.rotate = function(rotation, cx, cy) {
        var old_x = this.coords[0];
        var old_y = this.coords[1];
        var old_rotation = this.coords[2];

        // compute relative coords
        var rx = old_x - cx;
        var ry = old_y - cy;

        // compute new position and rotation
        var new_x = transform_x(rotation, rx, ry) + cx;
        var new_y = transform_y(rotation, rx, ry) + cy;
        var new_rotation = rotate[old_rotation * 8 + rotation];

        this.coords[0] = new_x;
        this.coords[1] = new_y;
        this.coords[2] = new_rotation;
        this.update_coords();

        // create a record of the change
        var component = this; // for closure
        this.aspect.add_change(function(diagram, action) {
            if (action == 'undo') {
                component.coords[0] = old_x;
                component.coords[1] = old_y;
                component.coords[2] = old_rotation;
            }
            else {
                component.coords[0] = new_x;
                component.coords[1] = new_y;
                component.coords[2] = new_rotation;
            }
            component.update_coords();
        });
    };

    Component.prototype.move_begin = function() {
        // remember where we started this move
        this.move_x = this.coords[0];
        this.move_y = this.coords[1];
        this.move_rotation = this.coords[2];
    };

    Component.prototype.move = function(dx, dy) {
        // update coordinates
        this.coords[0] += dx;
        this.coords[1] += dy;
        this.update_coords();
    };

    Component.prototype.move_end = function() {
        var dx = this.coords[0] - this.move_x;
        var dy = this.coords[1] - this.move_y;

        if (dx !== 0 || dy !== 0 || this.coords[2] != this.move_rotation) {
            // create a record of the change
            var component = this; // for closure
            this.aspect.add_change(function(diagram, action) {
                if (action == 'undo') component.move(-dx, - dy);
                else component.move(dx, dy);
                component.aspect.check_wires(component);
            });
            this.aspect.check_wires(this);
        }
    };

    Component.prototype.add = function(aspect) {
        this.aspect = aspect; // we now belong to a diagram!
        aspect.add_component(this);
        this.update_coords();

        // create a record of the change
        var component = this; // for closure
        aspect.add_change(function(diagram, action) {
            if (action == 'undo') component.remove();
            else component.add(diagram);
        });
    };

    Component.prototype.remove = function() {
        // remove connection points from diagram
        for (var i = this.connections.length - 1; i >= 0; i -= 1) {
            var cp = this.connections[i];
            this.aspect.remove_connection_point(cp, cp.location);
        }

        // remove component from diagram
        this.aspect.remove_component(this);

        // create a record of the change
        var component = this; // for closure
        this.aspect.add_change(function(diagram, action) {
            if (action == 'undo') component.add(diagram);
            else component.remove();
        });
    };

    Component.prototype.transform_x = function(x, y) {
        return transform_x(this.coords[2], x, y);
    };

    Component.prototype.transform_y = function(x, y) {
        return transform_y(this.coords[2], x, y);
    };

    Component.prototype.moveTo = function(diagram, x, y) {
        var nx = this.transform_x(x, y) + this.coords[0];
        var ny = this.transform_y(x, y) + this.coords[1];
        diagram.moveTo(nx, ny);
    };

    Component.prototype.lineTo = function(diagram, x, y) {
        var nx = this.transform_x(x, y) + this.coords[0];
        var ny = this.transform_y(x, y) + this.coords[1];
        diagram.lineTo(nx, ny);
    };

    var colors_rgb = {
        'red': 'rgb(255,64,64)',
        'green': 'rgb(64,255,64)',
        'blue': 'rgb(64,64,255)',
        'cyan': 'rgb(64,255,255)',
        'magenta': 'rgb(255,64,255)',
        'yellow': 'rgb(255,255,64)',
        'black': 'rgb(0,0,0)',
    };

    Component.prototype.draw_line = function(diagram, x1, y1, x2, y2, width) {
        diagram.c.strokeStyle = this.selected ? diagram.selected_style : this.type == 'wire' ? diagram.normal_style : (colors_rgb[this.properties.color] || diagram.component_style);
        var nx1 = this.transform_x(x1, y1) + this.coords[0];
        var ny1 = this.transform_y(x1, y1) + this.coords[1];
        var nx2 = this.transform_x(x2, y2) + this.coords[0];
        var ny2 = this.transform_y(x2, y2) + this.coords[1];
        diagram.draw_line(nx1, ny1, nx2, ny2, width || 1);
    };

    Component.prototype.draw_circle = function(diagram, x, y, radius, filled) {
        if (filled) diagram.c.fillStyle = this.selected ? diagram.selected_style : diagram.normal_style;
        else diagram.c.strokeStyle = this.selected ? diagram.selected_style : this.type == 'wire' ? diagram.normal_style : (colors_rgb[this.properties.color] || diagram.component_style);
        var nx = this.transform_x(x, y) + this.coords[0];
        var ny = this.transform_y(x, y) + this.coords[1];

        diagram.draw_arc(nx, ny, radius, 0, 2 * Math.PI, false, 1, filled);
    };

    // draw arc from [x1,y1] to [x2,y2] passing through [x3,y3]
    Component.prototype.draw_arc = function(diagram, x1, y1, x2, y2, x3, y3) {
        diagram.c.strokeStyle = this.selected ? diagram.selected_style : this.type == 'wire' ? diagram.normal_style : (colors_rgb[this.properties.color] || diagram.component_style);

        // transform coords, make second two points relative to x,y
        var x = this.transform_x(x1, y1) + this.coords[0];
        var y = this.transform_y(x1, y1) + this.coords[1];
        var dx = this.transform_x(x2, y2) + this.coords[0] - x;
        var dy = this.transform_y(x2, y2) + this.coords[1] - y;
        var ex = this.transform_x(x3, y3) + this.coords[0] - x;
        var ey = this.transform_y(x3, y3) + this.coords[1] - y;

        // compute center of circumscribed circle
        // http://en.wikipedia.org/wiki/Circumscribed_circle
        var D = 2 * (dx * ey - dy * ex);
        if (D === 0) { // oops, it's just a line
            diagram.draw_line(x, y, dx + x, dy + y, 1);
            return;
        }
        var dsquare = dx * dx + dy * dy;
        var esquare = ex * ex + ey * ey;
        var cx = (ey * dsquare - dy * esquare) / D;
        var cy = (dx * esquare - ex * dsquare) / D;
        var r = Math.sqrt((dx - cx) * (dx - cx) + (dy - cy) * (dy - cy)); // radius

        // compute start and end angles relative to circle's center.
        // remember that y axis is positive *down* the page;
        // canvas arc angle measurements: 0 = x-axis, then clockwise from there
        var start_angle = 2 * Math.PI - Math.atan2(-(0 - cy), 0 - cx);
        var end_angle = 2 * Math.PI - Math.atan2(-(dy - cy), dx - cx);

        // make sure arc passes through third point
        var middle_angle = 2 * Math.PI - Math.atan2(-(ey - cy), ex - cx);
        var angle1 = end_angle - start_angle;
        if (angle1 < 0) angle1 += 2 * Math.PI;
        var angle2 = middle_angle - start_angle;
        if (angle2 < 0) angle2 += 2 * Math.PI;
        var ccw = (angle2 > angle1);

        diagram.draw_arc(cx + x, cy + y, r, start_angle, end_angle, ccw, 1, false);
    };

    // result of rotating an alignment [rot*9 + align]
    var aOrient = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, // NORTH (identity)
    2, 5, 8, 1, 4, 7, 0, 3, 6, // EAST (rot270)
    8, 7, 6, 5, 4, 3, 2, 1, 0, // SOUTH (rot180)
    6, 3, 0, 7, 4, 1, 8, 5, 3, // WEST (rot90)
    2, 1, 0, 5, 4, 3, 8, 7, 6, // RNORTH (negy)
    8, 5, 2, 7, 4, 1, 6, 3, 0, // REAST (int-neg)
    6, 7, 8, 3, 4, 5, 0, 1, 2, // RSOUTH (negx)
    0, 3, 6, 1, 4, 7, 2, 5, 8 // RWEST (int-pos)
    ];

    var textAlign = ['left', 'center', 'right', 'left', 'center', 'right', 'left', 'center', 'right'];

    var textBaseline = ['top', 'top', 'top', 'middle', 'middle', 'middle', 'bottom', 'bottom', 'bottom'];

    Component.prototype.draw_text = function(diagram, text, x, y, alignment, font, fill) {
        var a = aOrient[this.coords[2] * 9 + alignment];
        diagram.c.textAlign = textAlign[a];
        diagram.c.textBaseline = textBaseline[a];
        if (fill === undefined) diagram.c.fillStyle = this.selected ? diagram.selected_style : (colors_rgb[this.properties.color] || diagram.component_style);
        else diagram.c.fillStyle = fill;
        diagram.draw_text(text,
        this.transform_x(x, y) + this.coords[0],
        this.transform_y(x, y) + this.coords[1],
        font);
    };

    Component.prototype.draw_text_important = function(diagram, text, x, y, alignment, font, fill) {
        var a = aOrient[this.coords[2] * 9 + alignment];
        diagram.c.textAlign = textAlign[a];
        diagram.c.textBaseline = textBaseline[a];
        if (fill === undefined) diagram.c.fillStyle = this.selected ? diagram.selected_style : diagram.normal_style;
        else diagram.c.fillStyle = fill;
        diagram.draw_text_important(text,
        this.transform_x(x, y) + this.coords[0],
        this.transform_y(x, y) + this.coords[1],
        font);
    };

    Component.prototype.draw = function(diagram) {
        // see if icon has been defined recently...
        if (this.icon === undefined) this.compute_bbox();

        if (this.icon && !this.icon.empty()) {
            var component = this; // for closure
            this.icon.map_over_components(function(c) {
                c.draw_icon(component, diagram);
            });
        }
        else this.draw_text_important(diagram, this.type, 0, 0, 4, diagram.annotation_font);
    };

    // does mouse click fall on this component?
    Component.prototype.near = function(x, y) {
        return this.inside(x, y);
    };

    Component.prototype.select = function(x, y, shiftKey) {
        this.was_previously_selected = this.selected;
        if (this.near(x, y)) {
            this.set_select(shiftKey ? !this.selected : true);
            return true;
        }
        else return false;
    };

    Component.prototype.select_rect = function(s) {
        if (intersect(this.bbox, s)) this.set_select(true);
    };

    // default: do nothing
    Component.prototype.bisect = function(c) {};

    // clear the labels on all connections
    Component.prototype.clear_labels = function() {
        for (var i = this.connections.length - 1; i >= 0; i -= 1) {
            this.connections[i].clear_label();
        }
    };

    // default action: don't propagate label
    Component.prototype.propagate_label = function(label) {};

    // component should generate labels for all unlabeled connections
    Component.prototype.label_connections = function(prefix) {
        for (var i = this.connections.length - 1; i >= 0; i -= 1) {
            var cp = this.connections[i];
            if (!cp.label) {
                // generate label of appropriate length
                var len = cp.nlist.length;
                var label = [];
                for (var j = 0; j < len; j += 1) {
                    label.push(this.aspect.get_next_label(prefix));
                }
                cp.propagate_label(label);
            }
        }
    };

    // give components a chance to generate a label for their connection(s).
    // valid for any component with a "global_signal" or "signal" property
    // (e.g., gnd, vdd, ports, wires).
    Component.prototype.add_default_labels = function(prefix, port_map) {
        var nlist, i;

        if (this.properties.global_signal)
        // no mapping or prefixing for global signals
        nlist = parse_signal(this.properties.global_signal);
        else {
            nlist = parse_signal(this.properties.signal);
            if (nlist.length > 0) {
                // substitute external names for local labels that are connected to ports
                // or add prefix to local labels
                for (i = 0; i < nlist.length; i += 1) {
                    var n = nlist[i];
                    if (n in port_map) nlist[i] = port_map[n];
                    else nlist[i] = prefix + n;
                }
            }
        }

        // now actually propagate label to connections (we're expecting only
        // only one connection for all but wires which will have two).
        if (nlist.length > 0) for (i = 0; i < this.connections.length; i += 1) {
            this.connections[i].propagate_label(nlist);
        }
    };

    // netlist entry: ["type", {terminal:signal, ...}, {property: value, ...}]
    Component.prototype.netlist = function(mlist, prefix) {
        var i;
        
        // match up connections to the component's terminals, determine
        // the number of instances implied by the connections.
        var connections = [];
        var ninstances = 1; // always at least one instance
        for (i = 0; i < this.connections.length; i += 1) {
            var c = this.connections[i];
            var got = c.label.length;
            var expected = c.nlist.length;
            if ((got % expected) !== 0) {
                throw "Number of connections for terminal " + c.name + "of " + this.prefix + this.properties.name + " not a multiple of " + expected.toString();
            }

            // infer number of instances and remember the max we find.
            // we'll replicate connections if necessary during the
            // expansion phase.
            ninstances = Math.max(ninstances, got / expected);

            // remember for expansion phase
            connections.push([c.nlist, c.label]);
        }

        // now create the appropriate number of instances
        var netlist = [];
        for (i = 0; i < ninstances; i += 1) {
            // build port map
            var port_map = {};
            for (var j = 0; j < connections.length; j += 1) {
                var nlist = connections[j][0]; // list of terminal names
                var slist = connections[j][1]; // list of connected signals
                var sindex = i * nlist.length; // where to start in slist
                for (var k = 0; k < nlist.length; k += 1)
                // keep cycling through entries in slist as necessary
                port_map[nlist[k]] = slist[(sindex + k) % slist.length];
            }

            if (mlist.indexOf(this.type) != -1) {
                // if leaf, create netlist entry
                var props = this.clone_properties(false);
                props.name = prefix + this.name;
                if (ninstances > 1) props.name += '[' + i.toString() + ']';
                netlist.push([this.type, port_map, props]);
                continue;
            }

            if (this.module.has_aspect(Schematic.prototype.editor_name)) {
                var sch = this.module.aspect(Schematic.prototype.editor_name);
                // extract component's schematic, add to our netlist
                var p = prefix + this.name;
                if (ninstances > 1) p += '[' + i.toString() + ']';
                p += '.'; // hierarchical name separator
                var result = sch.netlist(mlist, p, port_map);
                netlist.push.apply(netlist, result);
            }
            else {
                // if no schematic, complain
                throw "No schematic for " + prefix + this.properties.name + " an instance of " + this.type;
            }

        }
        return netlist;
    };

    Component.prototype.update_properties = function(new_properties) {
        if (new_properties !== undefined) {
            var old_properties = this.clone_properties(false);
            this.properties = new_properties;

            var component = this; // for closure
            this.aspect.add_change(function(diagram, action) {
                if (action == 'undo') component.properties = old_properties;
                else component.properties = new_properties;
            });
        }
    };

    Component.prototype.edit_properties = function(diagram, x, y, callback) {
        if (this.near(x, y) && Object.keys(this.properties).length > 0) {
            // make the appropriate input widget for each property
            var fields = {};
            for (var p in this.properties) {
                var mprop = this.module.properties[p];
                if (mprop.edit == 'no') continue; // skip uneditable props

                var lbl = mprop.label || p; // use provided label
                var input;
                if (mprop.type == 'menu') input = build_select(mprop.choices, this.properties[p]);
                else {
                    var v = this.properties[p];
                    input = build_input('text', Math.max(10, (v === undefined ? 1 : v.length) + 5), this.properties[p]);
                }
                input.prop_name = p;
                fields[lbl] = input;
            }

            var content = build_table(fields);
            var component = this;

            diagram.dialog('Edit Properties', content, function() {
                var new_properties = {};
                for (var i in fields) {
                    var v = fields[i].value;
                    if (v === '') v = undefined;
                    new_properties[fields[i].prop_name] = v;
                }
                component.name = new_properties.name; // used when extracting netlists

                // record the change
                diagram.aspect.start_action();
                component.update_properties(new_properties);
                diagram.aspect.end_action();

                if (callback) callback(component);

                diagram.redraw_background();
            });
            return true;
        }
        else return false;
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Connection point
    //
    ////////////////////////////////////////////////////////////////////////////////

    var connection_point_radius = 2;

    function ConnectionPoint(parent, x, y, name) {
        this.parent = parent;
        this.offset_x = x;
        this.offset_y = y;
        this.name = name;
        this.nlist = parse_signal(name);
        this.location = '';
        this.update_location();
        this.label = undefined;
    }
    exports.ConnectionPoint = ConnectionPoint;

    ConnectionPoint.prototype.clear_label = function() {
        this.label = undefined;
    };

    // return number of connection points coincidient with this one
    ConnectionPoint.prototype.nconnections = function() {
        var cplist = this.parent.aspect.connection_points[this.location];
        return cplist.length;
    };

    ConnectionPoint.prototype.propagate_label = function(label) {
        // should we check if existing label is the same?  it should be...

        if (this.label === undefined) {
            // label this connection point
            this.label = label;

            // propagate label to coincident connection points
            this.parent.aspect.propagate_label(label, this.location);

            // possibly label other cp's for this device?
            this.parent.propagate_label(label);
        }
        else if (!signal_equals(this.label, label))
        // signal an error while generating netlist
        throw "Node has two conflicting sets of labels: [" + this.label + "], [" + label + "]";
    };

    ConnectionPoint.prototype.update_location = function() {
        // update location string which we use as a key to find coincident connection points
        var old_location = this.location;
        var parent = this.parent;
        var nx = parent.transform_x(this.offset_x, this.offset_y) + parent.coords[0];
        var ny = parent.transform_y(this.offset_x, this.offset_y) + parent.coords[1];
        this.x = nx;
        this.y = ny;
        this.location = nx + ',' + ny;

        // add ourselves to the connection list for the new location
        if (this.parent.aspect) this.parent.aspect.update_connection_point(this, old_location);
    };

    ConnectionPoint.prototype.coincident = function(x, y) {
        return this.x == x && this.y == y;
    };

    ConnectionPoint.prototype.draw = function(diagram, n) {
        if (n != 2) this.parent.draw_circle(diagram, this.offset_x, this.offset_y,
        connection_point_radius, n > 2);
    };

    ConnectionPoint.prototype.draw_x = function(diagram) {
        this.parent.draw_line(diagram, this.offset_x - 2, this.offset_y - 2,
        this.offset_x + 2, this.offset_y + 2, diagram.grid_style);
        this.parent.draw_line(diagram, this.offset_x + 2, this.offset_y - 2,
        this.offset_x - 2, this.offset_y + 2, diagram.grid_style);
    };

    // see if three connection points are collinear
    function collinear(p1, p2, p3) {
        // from http://mathworld.wolfram.com/Collinear.html
        var area = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y);
        return area === 0;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Diagram editor base class
    //
    //////////////////////////////////////////////////////////////////////

    function Diagram(editor, class_name) {
        this.editor = editor;
        this.aspect = undefined;

        // setup canas
        this.canvas = document.createElement('canvas');
        this.canvas.className = class_name;

        this.sctl_r = 16; // scrolling control parameters
        this.sctl_x = this.sctl_r + 8; // upper left
        this.sctl_y = this.sctl_r + 8;
        this.zctl_left = this.sctl_x - 8;
        this.zctl_top = this.sctl_y + this.sctl_r + 8;

        // ethanschoonover.com
        this.background_style = 'rgb(250,250,250)'; // backgrund color for diagram [base3]
        this.grid_style = 'rgb(187,187,187)'; // grid on background [base1]
        this.normal_style = 'rgb(88,110,117)'; // default drawing color [base01]
        this.component_style = 'rgb(38,139,210)'; // color for unselected components [blue]
        this.selected_style = 'rgb(211,54,130)'; // highlight color for selected components [magenta]
        this.annotation_style = 'rgb(220,50,47)'; // color for diagram annotations [red]

        this.property_font = '5pt sans-serif'; // point size for Component property text
        this.annotation_font = '6pt sans-serif'; // point size for diagram annotations

        // repaint simply draws this buffer and then adds selected elements on top
        this.bg_image = document.createElement('canvas');

        this.canvas.tabIndex = 1; // so we get keystrokes

        this.canvas.diagram = this;

        // initial state
        this.dragging = false;
        this.select_rect = undefined;
        this.annotations = [];
        this.show_grid = true;

        this.origin_x = 0;
        this.origin_y = 0;
        this.cursor_x = 0;
        this.cursor_y = 0;
        this.unsel_bbox = [Infinity, Infinity, - Infinity, - Infinity];
        this.bbox = [0, 0, 0, 0];

        // for management of pop-up windows and dialogs
        this.window_list = [];
    }

    Diagram.prototype.netlist = function(mlist) {
        try {
            var netlist = this.aspect.netlist(mlist, '', {});
            return netlist;
        }
        catch (e) {
            //throw e;  // for debugging
            alert("Error extracting netlist:\n\n" + e);
            return [];
        }
    };

    // fetch attributes from the tag that created us
    Diagram.prototype.getAttribute = function(attr) {
        return undefined;
    };

    Diagram.prototype.set_aspect = function(aspect) {
        this.aspect = aspect;
        this.redraw_background(); // compute bounding box
        this.zoomall(); // let's see the whole diagram
    };

    Diagram.prototype.unselect_all = function(which) {
        this.annotations = []; // remove all annotations

        this.aspect.map_over_components(function(c, i) {
            if (i != which) c.set_select(false);
        });
    };

    Diagram.prototype.remove_annotations = function() {
        this.unselect_all();
        this.redraw_background();
    };

    Diagram.prototype.add_annotation = function(callback) {
        this.annotations.push(callback);
        this.redraw();
    };

    Diagram.prototype.drag_begin = function() {
        // let components know they're about to move
        var cursor_grid = 1;
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.move_begin();
                cursor_grid = Math.max(cursor_grid, c.required_grid);
            }
        });
        this.set_cursor_grid(cursor_grid);

        // remember where drag started
        this.drag_x = this.cursor_x;
        this.drag_y = this.cursor_y;
        this.dragging = true;
    };

    Diagram.prototype.drag_end = function() {
        // let components know they're done moving
        this.aspect.map_over_components(function(c) {
            if (c.selected) c.move_end();
        });
        this.dragging = false;
        this.aspect.end_action();
        this.redraw_background();
    };

    Diagram.prototype.zoomin = function() {
        var nscale = this.scale * this.zoom_factor;

        if (nscale < this.zoom_max) {
            // keep center of view unchanged
            this.origin_x += (this.canvas.clientWidth / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.origin_y += (this.canvas.clientHeight / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.scale = nscale;
            this.redraw_background();
        }
    };

    Diagram.prototype.zoomout = function() {
        var nscale = this.scale / this.zoom_factor;

        if (nscale > this.zoom_min) {
            // keep center of view unchanged
            this.origin_x += (this.canvas.clientWidth / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.origin_y += (this.canvas.clientHeight / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.scale = nscale;
            this.redraw_background();
        }
    };

    Diagram.prototype.zoomall = function() {
        // w,h for diagram including a margin on all sides
        var diagram_w = 1.5 * (this.bbox[2] - this.bbox[0]);
        var diagram_h = 1.5 * (this.bbox[3] - this.bbox[1]);

        if (diagram_w === 0) this.scale = 1;
        else {
            // compute scales that would make diagram fit, choose smallest
            var scale_x = this.canvas.clientWidth / diagram_w;
            var scale_y = this.canvas.clientHeight / diagram_h;
            this.scale = Math.pow(this.zoom_factor,
            Math.ceil(Math.log(Math.min(scale_x, scale_y)) / Math.log(this.zoom_factor)));
            if (this.scale < this.zoom_min) this.scale = this.zoom_min;
            else if (this.scale > this.zoom_max) this.scale = this.zoom_max;
        }

        // center the diagram
        this.origin_x = (this.bbox[2] + this.bbox[0]) / 2 - this.canvas.clientWidth / (2 * this.scale);
        this.origin_y = (this.bbox[3] + this.bbox[1]) / 2 - this.canvas.clientHeight / (2 * this.scale);

        this.redraw_background();
    };

    function diagram_undo(diagram) {
        diagram.aspect.undo();
        diagram.unselect_all(-1);
        diagram.redraw_background();
    }

    function diagram_redo(diagram) {
        diagram.aspect.redo();
        diagram.unselect_all(-1);
        diagram.redraw_background();
    }

    function diagram_cut(diagram) {
        // clear previous contents
        clipboards[diagram.editor.editor_name] = [];

        // look for selected components, move them to clipboard.
        diagram.aspect.start_action();
        diagram.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.remove();
                clipboards[diagram.editor.editor_name].push(c);
            }
        });
        diagram.aspect.end_action();

        // update diagram view
        diagram.redraw();
    }

    function diagram_copy(diagram) {
        // clear previous contents
        clipboards[diagram.editor.editor_name] = [];

        // look for selected components, copy them to clipboard.
        diagram.aspect.map_over_components(function(c) {
            if (c.selected) clipboards[diagram.editor.editor_name].push(c.clone(c.coords[0], c.coords[1]));
        });

        diagram.redraw(); // digram didn't change, but toolbar status may have
    }

    function diagram_paste(diagram) {
        var clipboard = clipboards[diagram.editor.editor_name];
        var i, c;

        // compute left,top of bounding box for origins of
        // components in the clipboard
        var left;
        var top;
        var cursor_grid = 1;
        for (i = clipboard.length - 1; i >= 0; i -= 1) {
            c = clipboard[i];
            left = left ? Math.min(left, c.coords[0]) : c.coords[0];
            top = top ? Math.min(top, c.coords[1]) : c.coords[1];
            cursor_grid = Math.max(cursor_grid, c.required_grid);
        }
        diagram.set_cursor_grid(cursor_grid);
        left = diagram.on_grid(left);
        top = diagram.on_grid(top);

        // clear current selections
        diagram.unselect_all(-1);
        diagram.redraw_background(); // so we see any components that got unselected

        // make clones of components on the clipboard, positioning
        // them relative to the cursor
        diagram.aspect.start_action();
        for (i = clipboard.length - 1; i >= 0; i -= 1) {
            c = clipboard[i];
            var new_c = c.clone(diagram.cursor_x + (c.coords[0] - left), diagram.cursor_y + (c.coords[1] - top));
            new_c.set_select(true);
            new_c.add(diagram.aspect);
        }
        diagram.aspect.end_action();

        // see what we've wrought
        diagram.redraw();
    }

    Diagram.prototype.set_cursor_grid = function(g) {
        this.cursor_grid = g;
        this.cursor_x = this.on_grid(this.aspect_x);
        this.cursor_y = this.on_grid(this.aspect_y);
    };

    // determine nearest grid point
    Diagram.prototype.on_grid = function(v, grid) {
        if (grid === undefined) grid = this.cursor_grid;
        if (v < 0) return Math.floor((-v + (grid >> 1)) / grid) * -grid;
        else return Math.floor((v + (grid >> 1)) / grid) * grid;
    };

    // rotate selection about center of its bounding box
    Diagram.prototype.rotate = function(rotation) {
        var bbox = this.aspect.selected_bbox();
        var grid = this.aspect.selected_grid();

        // compute center of bounding box, ensure it's on grid
        var cx = this.on_grid((bbox[0] + bbox[2]) >> 1, grid);
        var cy = this.on_grid((bbox[1] + bbox[3]) >> 1, grid);

        this.aspect.start_action();

        // rotate each selected component relative center of bbox
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.move_begin();
                c.rotate(rotation, cx, cy);
            }
        });

        // to prevent creep, recompute bounding box and move
        // to old center
        bbox = this.aspect.selected_bbox();
        var dx = cx - this.on_grid((bbox[0] + bbox[2]) >> 1, grid);
        var dy = cy - this.on_grid((bbox[1] + bbox[3]) >> 1, grid);
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                if (dx !== 0 || dy !== 0) c.move(dx, dy);
                c.move_end();
            }
        });
        this.aspect.end_action();
        this.redraw();
    };

    // flip selection horizontally
    function diagram_fliph(diagram) {
        diagram.rotate(4);
    }

    // flip selection vertically
    function diagram_flipv(diagram) {
        diagram.rotate(6);
    }

    // rotate selection clockwise
    function diagram_rotcw(diagram) {
        diagram.rotate(1);
    }

    // rotate selection counterclockwise
    function diagram_rotccw(diagram) {
        diagram.rotate(3);
    }

    Diagram.prototype.resize = function() {
        var w = this.canvas.clientWidth;
        var h = this.canvas.clientHeight;
        this.canvas.width = w;
        this.canvas.height = h;
        this.bg_image.width = w;
        this.bg_image.height = h;
        this.zoomall();
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Drawing support -- deals with scaling and scrolling of diagrama
    //
    ////////////////////////////////////////////////////////////////////////////////

    // here to redraw background image containing static portions of the diagram
    // Also redraws dynamic portion.
    Diagram.prototype.redraw_background = function() {
        var c = this.bg_image.getContext('2d');
        this.c = c;

        c.lineCap = 'round';

        // paint background color -- use color from style sheet
        c.fillStyle = this.background_style;
        c.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

        if (!this.diagram_only && this.show_grid) {
            // grid
            c.strokeStyle = this.grid_style;
            var first_x = this.origin_x;
            var last_x = first_x + this.canvas.clientWidth / this.scale;
            var first_y = this.origin_y;
            var last_y = first_y + this.canvas.clientHeight / this.scale;
            var i;

            for (i = this.grid * Math.ceil(first_x / this.grid); i < last_x; i += this.grid) {
                this.draw_line(i, first_y, i, last_y, 0.1);
            }

            for (i = this.grid * Math.ceil(first_y / this.grid); i < last_y; i += this.grid) {
                this.draw_line(first_x, i, last_x, i, 0.1);
            }

            // indicate origin
            this.draw_arc(0, 0, this.grid / 2, 0, 2 * Math.PI, false, 0.2, false);
        }

        // unselected components
        this.unsel_bbox = this.aspect.unselected_bbox();

        var diagram = this; // for closure below
        this.aspect.map_over_components(function(c) {
            if (!c.selected) c.draw(diagram);
        });

        this.redraw(); // background changed, redraw on screen
    };

    // redraw what user sees = static image + dynamic parts
    Diagram.prototype.redraw = function() {
        var c = this.canvas.getContext('2d');
        this.c = c;

        // put static image in the background
        c.drawImage(this.bg_image, 0, 0);

        // selected components
        this.bbox = this.aspect.selected_bbox(this.unsel_bbox);
        if (this.bbox[0] == Infinity) this.bbox = [0, 0, 0, 0];

        var diagram = this; // for closure below
        this.aspect.map_over_components(function(c) {
            if (c.selected) c.draw(diagram);
        });


        var toolbar = this.editor.toolbar;
        if (toolbar) toolbar.enable_tools(this);

        // connection points: draw one at each location
        for (var location in this.aspect.connection_points) {
            var cplist = this.aspect.connection_points[location];
            cplist[0].draw(this, cplist.length);
        }

        // draw editor-specific dodads
        this.editor.redraw(this);

        // draw selection rectangle
        if (this.select_rect) {
            var t = this.select_rect;
            c.lineWidth = 1;
            c.strokeStyle = this.selected_style;
            c.beginPath();
            c.moveTo(t[0], t[1]);
            c.lineTo(t[0], t[3]);
            c.lineTo(t[2], t[3]);
            c.lineTo(t[2], t[1]);
            c.lineTo(t[0], t[1]);
            c.stroke();
        }

        // add any annotations
        for (var i = 0; i < this.annotations.length; i += 1) {
            // annotations are callbacks that get a chance to do their thing
            this.annotations[i](this);
        }

        // add scrolling/zooming control
        var r = this.sctl_r;
        var x = this.sctl_x;
        var y = this.sctl_y;

        // circle with border
        c.fillStyle = this.background_style;
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.fill();

        c.strokeStyle = this.grid_style;
        c.lineWidth = 0.5;
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.stroke();

        // direction markers for scroll
        c.lineWidth = 3;
        c.beginPath();

        c.moveTo(x + 4, y - r + 8); // north
        c.lineTo(x, y - r + 4);
        c.lineTo(x - 4, y - r + 8);

        c.moveTo(x + r - 8, y + 4); // east
        c.lineTo(x + r - 4, y);
        c.lineTo(x + r - 8, y - 4);

        c.moveTo(x + 4, y + r - 8); // south
        c.lineTo(x, y + r - 4);
        c.lineTo(x - 4, y + r - 8);

        c.moveTo(x - r + 8, y + 4); // west
        c.lineTo(x - r + 4, y);
        c.lineTo(x - r + 8, y - 4);

        c.stroke();

        // zoom control
        x = this.zctl_left;
        y = this.zctl_top;
        c.lineWidth = 0.5;
        c.fillStyle = this.background_style; // background
        c.fillRect(x, y, 16, 48);
        c.strokeStyle = this.grid_style; // border
        c.strokeRect(x, y, 16, 48);
        c.lineWidth = 1.0;
        c.beginPath();
        // zoom in label
        c.moveTo(x + 4, y + 8);
        c.lineTo(x + 12, y + 8);
        c.moveTo(x + 8, y + 4);
        c.lineTo(x + 8, y + 12);
        // zoom out label
        c.moveTo(x + 4, y + 24);
        c.lineTo(x + 12, y + 24);
        c.stroke();
        // surround label
        c.strokeRect(x + 4, y + 36, 8, 8);
        c.fillStyle = this.background_style;
        c.fillRect(x + 7, y + 34, 2, 10);
        c.fillRect(x + 3, y + 39, 10, 2);
    };

    Diagram.prototype.moveTo = function(x, y) {
        this.c.moveTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    Diagram.prototype.lineTo = function(x, y) {
        this.c.lineTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    Diagram.prototype.draw_line = function(x1, y1, x2, y2, width) {
        var c = this.c;
        c.lineWidth = width * this.scale;
        c.beginPath();
        c.moveTo((x1 - this.origin_x) * this.scale, (y1 - this.origin_y) * this.scale);
        c.lineTo((x2 - this.origin_x) * this.scale, (y2 - this.origin_y) * this.scale);
        c.stroke();
    };

    Diagram.prototype.draw_arc = function(x, y, radius, start_radians, end_radians, anticlockwise, width, filled) {
        var c = this.c;
        c.lineWidth = width * this.scale;
        c.beginPath();
        c.arc((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale, radius * this.scale,
        start_radians, end_radians, anticlockwise);
        if (filled) c.fill();
        else c.stroke();
    };

    Diagram.prototype.draw_text = function(text, x, y, font) {
        var c = this.c;

        // scale font size appropriately
        var s = font.match(/\d+/)[0];
        s = Math.max(2, Math.round(s * this.scale));
        c.font = font.replace(/\d+/, s.toString());

        c.fillText(text, (x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    Diagram.prototype.draw_text_important = function(text, x, y, font) {
        this.draw_text(text, x, y, font);
    };

    // convert event coordinates into
    //   mouse_x,mouse_y = coords relative to upper left of canvas
    //   aspect_x,aspect_y = coords in aspect's coordinate system
    //   cursor_x,cursor_y = aspect coords rounded to nearest grid point
    Diagram.prototype.event_coords = function(event) {
        var pos = $(this.canvas).offset();
        this.mouse_x = event.pageX - pos.left;
        this.mouse_y = event.pageY - pos.top;
        this.aspect_x = this.mouse_x / this.scale + this.origin_x;
        this.aspect_y = this.mouse_y / this.scale + this.origin_y;
        this.cursor_x = this.on_grid(this.aspect_x);
        this.cursor_y = this.on_grid(this.aspect_y);
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Event handling
    //
    ////////////////////////////////////////////////////////////////////////////////

    // process keystrokes, consuming those that are meaningful to us
    Diagram.prototype.key_down = function(event) {
        var code = event.keyCode;

        // backspace or delete: delete selected components
        if (code == 8 || code == 46) {
            // delete selected components
            this.aspect.start_action();
            this.aspect.map_over_components(function(c) {
                if (c.selected) c.remove();
            });
            this.aspect.end_action();
            this.redraw_background();
        }

        // cmd/ctrl a: select all
        else if ((event.ctrlKey || event.metaKey) && code == 65) {
            this.aspect.map_over_components(function(c) {
                c.set_select(true);
            });
            this.redraw_background();
        }

        // cmd/ctrl c: copy
        else if ((event.ctrlKey || event.metaKey) && code == 67) {
            diagram_copy(this);
        }

        // cmd/ctrl v: paste
        else if ((event.ctrlKey || event.metaKey) && code == 86) {
            diagram_paste(this);
        }

        // cmd/ctrl x: cut
        else if ((event.ctrlKey || event.metaKey) && code == 88) {
            diagram_cut(this);
        }

        // cmd/ctrl y: redo
        else if ((event.ctrlKey || event.metaKey) && code == 89) {
            diagram_redo(this);
        }

        // cmd/ctrl z: undo
        else if ((event.ctrlKey || event.metaKey) && code == 90) {
            diagram_undo(this);
        }

        else return true;

        event.preventDefault();
        return false;
    };

    // handle events in pan/zoom control
    Diagram.prototype.pan_zoom = function() {
        var mx = this.mouse_x;
        var my = this.mouse_y;
        var sx = mx - this.sctl_x;
        var sy = my - this.sctl_y;
        var zx = mx - this.zctl_left;
        var zy = my - this.zctl_top;
        var delta,temp;
        
        if (sx * sx + sy * sy <= this.sctl_r * this.sctl_r) { // click in scrolling control
            // click on scrolling control, check which quadrant
            if (Math.abs(sy) > Math.abs(sx)) { // N or S
                delta = this.canvas.height / (8 * this.scale);
                if (sy > 0) delta = -delta;
                temp = this.origin_y - delta;
                if (temp > this.origin_min * this.grid && temp < this.origin_max * this.grid) this.origin_y = temp;
            }
            else { // E or W
                delta = this.canvas.width / (8 * this.scale);
                if (sx < 0) delta = -delta;
                temp = this.origin_x + delta;
                if (temp > this.origin_min * this.grid && temp < this.origin_max * this.grid) this.origin_x = temp;
            }
        }
        else if (zx >= 0 && zx < 16 && zy >= 0 && zy < 48) { // click in zoom control
            if (zy < 16) this.zoomin();
            else if (zy < 32) this.zoomout();
            else this.zoomall();
        }
        else return false;

        this.redraw_background();
        return true;
    };

    // handle the (possible) start of a selection
    Diagram.prototype.start_select = function(shiftKey) {
        // give all components a shot at processing the selection event
        var which = -1;
        var diagram = this; // for closure
        this.aspect.map_over_components(function(c, i) {
            if (c.select(diagram.aspect_x, diagram.aspect_y, shiftKey)) {
                if (c.selected) {
                    diagram.aspect.start_action();
                    diagram.drag_begin();
                    which = i; // keep track of component we found
                }
                return true;
            }
        });

        if (!shiftKey) {
            // did we just click on a previously selected component?
            var reselect = which != -1 && this.aspect.components[which].was_previously_selected;

            // if shift key isn't pressed and we didn't click on component
            // that was already selected, unselect everyone except component
            // we just clicked on
            if (!reselect) this.unselect_all(which);

            // if there's nothing to drag, set up a selection rectangle
            if (!this.dragging) this.select_rect = [this.mouse_x, this.mouse_y,
            this.mouse_x, this.mouse_y];
        }

        this.redraw_background();
    };

    // handle dragging and selection rectangle
    Diagram.prototype.mouse_move = function() {
        if (this.dragging) {
            // see how far we moved
            var dx = this.cursor_x - this.drag_x;
            var dy = this.cursor_y - this.drag_y;
            if (dx !== 0 || dy !== 0) {
                // update position for next time
                this.drag_x = this.cursor_x;
                this.drag_y = this.cursor_y;

                // give all components a shot at processing the event
                this.aspect.map_over_components(function(c) {
                    if (c.selected) c.move(dx, dy);
                });
            }
        }
        else if (this.select_rect) {
            // update moving corner of selection rectangle
            this.select_rect[2] = this.mouse_x;
            this.select_rect[3] = this.mouse_y;
        }

        // just redraw dynamic components
        this.redraw();
    };

    // handle dragging and selection rectangle
    Diagram.prototype.mouse_up = function(shiftKey) {
        // dragging
        if (this.dragging) this.drag_end();

        // selection rectangle
        if (this.select_rect) {
            var r = this.select_rect;

            // if select_rect is a point, we've already dealt with selection
            // in mouse_down handler
            if (r[0] != r[2] || r[1] != r[3]) {
                // convert to diagram coordinates
                var s = [r[0] / this.scale + this.origin_x, r[1] / this.scale + this.origin_y,
                r[2] / this.scale + this.origin_x, r[3] / this.scale + this.origin_y];
                canonicalize(s);

                if (!shiftKey) this.unselect_all();

                // select components that intersect selection rectangle
                this.aspect.map_over_components(function(c) {
                    c.select_rect(s, shiftKey);
                });
            }

            this.select_rect = undefined;
            this.redraw_background();
        }
    };

    Diagram.prototype.message = function(message) {
        var status = this.editor.status;

        if (status) status.nodeValue = message;
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Dialogs and windows
    //
    ////////////////////////////////////////////////////////////////////////////////

    // set up a dialog with specified title, content and two buttons at
    // the bottom: OK and Cancel.  If Cancel is clicked, dialog goes away
    // and we're done.  If OK is clicked, dialog goes away and the
    // callback function is called with the content as an argument (so
    // that the values of any fields can be captured).
    Diagram.prototype.dialog = function(title, content, callback) {
        // create the div for the top level of the dialog, add to DOM
        var dialog = document.createElement('div');
        dialog.callback = callback;

        // look for property input fields in the content and give
        // them a keypress listener that interprets ENTER as
        // clicking OK.
        var plist = content.getElementsByClassName('property');
        for (var i = plist.length - 1; i >= 0; i -= 1) {
            var field = plist[i];
            field.dialog = dialog; // help event handler find us...
            $(field).keypress(dialog_check_for_ENTER);
        }

        // div to hold the content
        var body = document.createElement('div');
        content.style.marginBotton = '5px';
        body.appendChild(content);
        body.style.padding = '5px';
        dialog.appendChild(body);

        // OK button
        var ok_button = document.createElement('span');
        ok_button.appendChild(document.createTextNode('OK'));
        ok_button.dialog = dialog; // for the handler to use
        $(ok_button).click(dialog_okay);
        ok_button.className = 'jade-dialog-button';

        // cancel button
        var cancel_button = document.createElement('span');
        cancel_button.appendChild(document.createTextNode('Cancel'));
        cancel_button.dialog = dialog; // for the handler to use
        $(cancel_button).click(dialog_cancel);
        cancel_button.className = 'jade-dialog-button';

        // div to hold the two buttons
        var buttons = document.createElement('div');
        buttons.appendChild(ok_button);
        buttons.appendChild(cancel_button);
        buttons.className = 'jade-dialog-buttons';
        dialog.appendChild(buttons);

        // put into an overlay window
        this.window(title, dialog);
    };

    // callback when user click "Cancel" in a dialog
    function dialog_cancel(event) {
        window_close(event.target.dialog.win);
    }

    // callback when user click "OK" in a dialog
    function dialog_okay(event) {
        var dialog = event.target.dialog;

        window_close(dialog.win);

        // invoke the callback with the dialog contents as the argument.
        // small delay allows browser to actually remove window beforehand
        if (dialog.callback) setTimeout(function() {
            dialog.callback();
        }, 1);
    }

    // callback for keypress in input fields: if user typed ENTER, act
    // like they clicked OK button.
    function dialog_check_for_ENTER(event) {
        if (event.keyCode == 13) dialog_okay(event);
    }

    // build a 2-column HTML table from an associative array (keys as text in
    // column 1, values in column 2).
    function build_table(a) {
        var tbl = document.createElement('table');

        // build a row for each element in associative array
        for (var i in a) {
            var label = document.createTextNode(i + ': ');
            var col1 = document.createElement('td');
            var nobr = document.createElement('nobr');
            nobr.appendChild(label);
            col1.appendChild(nobr);
            var col2 = document.createElement('td');
            col2.appendChild(a[i]);
            var row = document.createElement('tr');
            row.appendChild(col1);
            row.appendChild(col2);
            row.style.verticalAlign = 'center';
            tbl.appendChild(row);
        }

        return tbl;
    }
    exports.build_table = build_table;

    function build_button(label, callback) {
        var button = document.createElement('button');
        button.appendChild(document.createTextNode(label));
        $(button).click(callback);
        return button;
    }
    exports.build_button = build_button;

    // build an input field
    function build_input(type, size, value) {
        var input = document.createElement('input');
        input.type = type;
        input.size = size;
        input.className = 'property'; // make this easier to find later
        if (value === undefined) input.value = '';
        else input.value = value.toString();
        return input;
    }
    exports.build_input = build_input;

    // build a select widget using the strings found in the options array
    function build_select(options, selected, select) {
        if (select === undefined) select = document.createElement('select');
        for (var i = 0; i < options.length; i += 1) {
            var option = document.createElement('option');
            option.text = options[i];
            select.add(option);
            if (options[i] == selected) select.selectedIndex = i;
        }
        return select;
    }
    exports.build_select = build_select;

    Diagram.prototype.window = function(title, content, offset) {
        // create the div for the top level of the window
        var win = document.createElement('div');
        win.className = 'jade-window';
        win.diagram = this;
        win.content = content;
        win.drag_x = undefined;
        win.draw_y = undefined;

        // div to hold the title
        var head = document.createElement('div');
        head.className = 'jade-window-title';
        head.appendChild(document.createTextNode(title));
        head.win = win;
        // capture mouse events in title bar
        $(head).mousedown(window_mouse_down);
        win.head = head;

        var close_button = new Image();
        close_button.src = close_icon;
        close_button.style.cssFloat = 'right';
        $(close_button).click(window_close_button);
        close_button.win = win;
        head.appendChild(close_button);
        win.appendChild(head);

        win.appendChild(content);
        content.win = win; // so content can contact us
        $(content).toggleClass('jade-window-contents');

        if (content.resize) {
            var resize = document.createElement('img');
            resize.src = resize_icon;
            resize.className = 'jade-window-resize';
            resize.win = win;
            win.resize = function(dx, dy) {
                // change size of window and content
                var e = $(win);
                e.height(e.height() + dy);
                e.width(e.width() + dx);

                // let contents know new size
                e = $(content);
                content.resize(content, e.width() + dx, e.height() + dy);
            };
            $(resize).mousedown(window_resize_start);

            win.appendChild(resize);
        }

        this.canvas.parentNode.insertBefore(win, this.canvas);

        // position top,left of window where mouse is.  mouse_x and mouse_y
        // are relative to the canvas, so use its offset to figure things out
        var coffset = $(this.canvas).offset();
        coffset.top += this.mouse_y + (offset || 0);
        coffset.left += this.mouse_x + (offset || 0);
        $(win).offset(coffset);

        bring_to_front(win, true);
    };

    // adjust zIndex of pop-up window so that it is in front
    function bring_to_front(win, insert) {
        var wlist = win.diagram.window_list;
        var i = wlist.indexOf(win);

        // remove from current position (if any) in window list
        if (i != -1) wlist.splice(i, 1);

        // if requested, add to end of window list
        if (insert) wlist.push(win);

        // adjust all zIndex values
        for (i = 0; i < wlist.length; i += 1) {
            wlist[i].style.zIndex = 100 + i;
        }
    }

    // close the window
    function window_close(win) {
        // remove the window from the top-level div of the diagram
        win.parentNode.removeChild(win);

        // remove from list of pop-up windows
        bring_to_front(win, false);
    }
    exports.window_close = window_close;

    function window_close_button(event) {
        window_close(event.target.win);
    }

    // capture mouse events in title bar of window
    function window_mouse_down(event) {
        var win = event.target.win;

        bring_to_front(win, true);

        // add handlers to document so we capture them no matter what
        $(document).mousemove(window_mouse_move);
        $(document).mouseup(window_mouse_up);
        document.tracking_window = win;

        // in Chrome avoid selecting everything as we drag window
        win.saved_onselectstart = document.onselectstart;
        document.onselectstart = function() {
            return false;
        };

        // remember where mouse is so we can compute dx,dy during drag
        win.drag_x = event.pageX;
        win.drag_y = event.pageY;

        return false;
    }

    function window_mouse_up(event) {
        var win = document.tracking_window;

        // show's over folks...
        $(document).unbind('mousemove');
        $(document).unbind('mouseup');
        document.tracking_window = undefined;
        win.drag_x = undefined;
        win.drag_y = undefined;

        document.onselectstart = win.saved_onselectstart;

        return false; // consume event
    }

    function window_mouse_move(event) {
        var win = document.tracking_window;

        if (win.drag_x) {
            var dx = event.pageX - win.drag_x;
            var dy = event.pageY - win.drag_y;

            // move window by dx,dy
            var offset = $(win).offset();
            offset.top += dy;
            offset.left += dx;
            $(win).offset(offset);

            // update reference point
            win.drag_x += dx;
            win.drag_y += dy;

            return false; // consume event
        }
    }

    function window_resize_start(event) {
        var win = event.target.win;
        var lastX = event.pageX;
        var lastY = event.pageY;

        $(document).mousemove(function(event) {
            win.resize(event.pageX - lastX, event.pageY - lastY);
            lastX = event.pageX;
            lastY = event.pageY;
            return false;
        });

        $(document).mouseup(function(event) {
            $(document).unbind('mousemove');
            $(document).unbind('mouseup');
            return false;
        });

        return false;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Toolbar
    //
    //////////////////////////////////////////////////////////////////////

    function Toolbar(diagram) {
        this.diagram = diagram;
        this.tools = {};
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'jade-toolbar';
    }

    Toolbar.prototype.add_tool = function(tname, icon, tip, handler, enable_check) {
        var tool;
        if (icon.search('data:image') != -1) {
            tool = document.createElement('img');
            tool.src = icon;
        }
        else {
            tool = document.createElement('span');
            var label = document.createTextNode(icon);
            tool.appendChild(label);
        }
        tool.className = 'jade-tool jade-tool-disabled';
        tool.enabled = false;

        // set up event processing
        $(tool).mouseover(tool_enter).mouseout(tool_leave).click(tool_click);

        // add to toolbar
        tool.diagram = this.diagram;
        tool.tip = tip;
        tool.callback = handler;
        tool.enable_check = enable_check;
        this.tools[tname] = tool;
        this.toolbar.appendChild(tool);

        return tool;
    };

    Toolbar.prototype.add_spacer = function() {
        var spacer = document.createElement('div');
        spacer.className = 'jade-tool-spacer';
        this.toolbar.appendChild(spacer);
    };

    Toolbar.prototype.enable_tools = function(diagram) {
        // loop through the tools, updating their enabled status
        for (var t in this.tools) {
            var tool = this.tools[t];
            var which = tool.enable_check ? tool.enable_check(diagram) : true;
            tool.enabled = which;
            $(tool).toggleClass('jade-tool-disabled', !which);
            $(tool).toggleClass('jade-tool-enabled', which);
        }
    };

    // display tip when mouse is over tool
    function tool_enter(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.message(tool.tip);
        }
    }

    // clear tip when mouse leaves
    function tool_leave(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.message('');
        }
    }

    // handle click on a tool
    function tool_click(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.event_coords(event); // so we can position pop-up window correctly
            tool.callback(tool.diagram);
        }
    }

    var undo_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQj8MhJq704622JJ0hFTB4FmuPYoepKfld7fKUZcojM7XzvZxEAOw==';

    var redo_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQk8MhJq704630Q+YTmUd8UmldYoukqnRUId/Mh1wTC7Xzv/5QIADs=';

    var cut_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQu8MhJqz1g5qs7lxv2gRkQfuWomarXEgDRHjJhf3YtyRav0xcfcFgR0nhB5OwTAQA7';

    var copy_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQ+8MhJ6wE4Wwqef9gmdV8HiKZJrCz3ecS7TikWfzExvk+M9a0a4MbTkXCgTMeoHPJgG5+yF31SLazsTMTtViIAOw==';

    var paste_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAARL8MhJqwUYWJnxWp3GDcgAgCdQIqLKXmVLhhnyHiqpr7rME8AgocVDEB5IJHD0SyofBFzxGIQGAbvB0ZkcTq1CKK6z5YorwnR0w44AADs=';

    var close_icon = 'data:image/gif;base64,R0lGODlhEAAQAMQAAGtra/f3/62tre/v9+bm787O1pycnHNzc6WlpcXFxd7e3tbW1nt7e7W1te/v74SEhMXFzmNjY+bm5v///87OzgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAAAAAAALAAAAAAQABAAAAVt4DRMZGmSwRQQBUS9MAwRIyQ5Uq7neEFSDtxOF4T8cobIQaE4RAQ5yjHHiCCSD510QtFGvoCFdppDfBu7bYzy+D7WP5ggAgA8Y3FKwi5IAhIweW1vbBGEWy5rilsFi2tGAwSJixAFBCkpJ5ojIQA7';

    var grid_icon = 'data:image/gif;base64,R0lGODlhEAAQAMQAAAAAAP///zAwYT09bpGRqZ6et5iYsKWlvbi40MzM5cXF3czM5OHh5tTU2fDw84uMom49DbWKcfLy8g0NDcDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAABQALAAAAAAQABAAAAUtICWOZGmeKDCqIlu68AvMdO2ueHvGuslTN6Bt6MsBd8Zg77hsDW3FpRJFrYpCADs=';

    var fliph_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQs8MhJq704ZyC5Bh74hd7FhUVZnV1qdq27wgdQyFOJ3qoe472fDEQkFTXIZAQAOw==';

    var flipv_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQr8MhJq7UA3JqP3t7nbR0lTiXHZWx7gnCMui4GFHhevLO+w5kcz/aThYyWCAA7';

    var rotcw_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQ38MhJq734kGzJ5prnScD1jWRJfRoFqBNbAQXM0XZG13q556mDr0C0vSbDYtAlJBZf0KgwCuREAAA7';

    var rotccw_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQ38MhJq73YklzJzoDkjRcQit9HmZSqHkBxaqvMSbF95yFbFsAebDbJ2WY+GDAIq7BM0F40eqtEAAA7';


    var resize_icon = 'data:image/x-icon;base64,AAABAAEAEBAAAAEAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOwAAAA+AAAAAAAAAAAAAAAAAAAA7AAAAD4AAAAAAAAAAAAAAOwAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAA+AAAA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAAPgAAAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABPAAAA/wAAAE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE8AAAD/AAAATwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATwAAAP8AAABPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+AAAA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    var up_icon = 'data:image/x-icon;base64,AAABAAEAEBAAAAEAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/gACA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    var down_icon = 'data:image/x-icon;base64,AAABAAEAEBAAAAEAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4AAgP+AAID/gACA/4AAgP+AAID/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAID/gACA/4AAgP+AAID/gACA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/gACA/4AAgP+AAID/gACA/4AAgP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    //////////////////////////////////////////////////////////////////////
    //
    // Editor framework
    //
    //////////////////////////////////////////////////////////////////////

    var editors = []; // list of supported aspects
    exports.editors = editors;

    var clipboards = {}; // clipboards for each editor type
    exports.clipboards = clipboards;

    function Jade(owner) {
        owner.jade = this;
        var top_level = document.createElement('div');
        this.top_level = top_level;
        top_level.id = owner.id;
        top_level.className = 'jade-top-level';

        // insert framework into DOM
        owner.parentNode.insertBefore(top_level, owner);

        // set up top-level toolbar
        var toolbar = document.createElement('div');
        toolbar.id = 'jade-toolbar';
        top_level.appendChild(toolbar);

        // field for entering module names
        var e = document.createElement('input');
        this.input_field = e;
        e.type = 'text';
        $(e).keypress(function(event) {
            // when user hits ENTER, edit the specified module
            if (event.keyCode == 13) owner.jade.edit(event.target.value);
        });
        toolbar.appendChild(document.createTextNode('Module: '));
        toolbar.appendChild(e);

        // button for saving libraries
        e = document.createElement('button');
        e.appendChild(document.createTextNode('Save Modified Libraries'));
        $(e).click(function(event) {
            save_libraries();
        });
        toolbar.appendChild(e);

        this.status = document.createTextNode('');

        // now add a display tab for each registered editor
        var tabs_div = document.createElement('div');
        this.tabs = {};
        this.selected_tab = undefined;
        tabs_div.className = 'jade-tabs-div';
        top_level.appendChild(tabs_div);
        for (var i = 0; i < editors.length; i += 1) {
            var editor = editors[i];
            var ename = editor.prototype.editor_name;

            clipboards[ename] = []; // initialize editor's clipboard

            // add tab selector
            var tab = document.createElement('div');
            tab.className = 'jade-tab';
            tab.name = ename;
            tab.appendChild(document.createTextNode(ename));
            tabs_div.appendChild(tab);
            $(tab).click(function(event) {
                owner.jade.show(event.target.name);
                event.preventDefault();
            });

            // add body for each tab (only one will have display != none)
            var body = document.createElement('div');
            body.className = 'jade-tab-body';
            top_level.appendChild(body);
            // make a new editor for this aspect
            body.editor = new editor(body, this);

            this.tabs[ename] = [tab, body];
        }
        // select first aspect as the one to be displayed
        if (editors.length > 0) {
            this.show(editors[0].prototype.editor_name);
        }

        // add status line at the bottom
        e = document.createElement('div');
        e.className = 'jade-status';
        e.appendChild(this.status);
        var resize = document.createElement('img');
        resize.src = resize_icon;
        resize.className = 'jade-resize';
        e.appendChild(resize);
        top_level.appendChild(e);

        resize.jade = this;
        $(resize).mousedown(resize_mouse_down);

        this.status.nodeValue = 'Copyright \u00A9 MIT 2011-2013';
    }

    Jade.prototype.edit = function(module) {
        if (typeof module == 'string') module = find_module(module);

        this.input_field.value = module.library.name + ':' + module.name;

        // tell each tab which module we're editing
        for (var e in this.tabs) {
            this.tabs[e][1].editor.set_aspect(module);
        }
    };

    // make a particular tab visible -- DOM class name does the heavy lifting
    Jade.prototype.show = function(tab_name) {
        this.selected_tab = tab_name;
        for (var tab in this.tabs) {
            var e = this.tabs[tab]; // [tab div, body div]
            var selected = (tab == tab_name);
            //e[0].className = 'jade-tab';
            $(e[0]).toggleClass('jade-tab-active', selected);
            $(e[1]).toggleClass('jade-tab-body-active', selected);
            if (selected) e[1].editor.show();
        }
    };

    Jade.prototype.resize = function(dx, dy) {
        var e = $(this.top_level);
        e.width(dx + e.width());
        e.height(dy + e.height());

        // adjust size of all the tab bodies
        for (var tab in this.tabs) {
            var ediv = this.tabs[tab][1]; // [tab div, body div]
            e = $(ediv);
            e.width(dx + e.width());
            e.height(dy + e.height());
            // inform associated editor about its new size
            ediv.editor.resize(dx, dy, tab == this.selected_tab);
        }
    };

    exports.Jade = Jade;

    function resize_mouse_down(event) {
        var jade = event.target.jade;
        var lastX = event.pageX;
        var lastY = event.pageY;

        $(document).mousemove(function(event) {
            jade.resize(event.pageX - lastX, event.pageY - lastY);
            lastX = event.pageX;
            lastY = event.pageY;
            return false;
        });

        $(document).mouseup(function(event) {
            $(document).unbind('mousemove');
            $(document).unbind('mouseup');
            return false;
        });

        return false;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Schematic editor
    //
    //////////////////////////////////////////////////////////////////////

    var schematic_tools = [];
    exports.schematic_tools = schematic_tools;

    //schematic_tools.push(['netlist','netlist','Extract netlist',extract_netlist]);

    var netlist; // keep last extraction here
    function extract_netlist(diagram) {
        // use modules in the analog library as the leafs
        var mlist = [];

        // analog extraction
        for (var m in libraries.analog.modules) {
            mlist.push('analog:' + m);
        }

        /*
        // gate extraction
        for (m in libraries.gates.modules) mlist.push('gates:'+m);
        mlist.push('analog:port-in');
        mlist.push('analog:port-out');
        mlist.push('analog:s');
        mlist.push('analog:v');
        mlist.push('analog:g');
        mlist.push('analog:vdd');
        */

        netlist = diagram.netlist(mlist);
        print_netlist();
    }

    var dont_print = {
        'analog:g': true,
        'analog:vdd': true,
        'analog:s': true,
        'analog:port-in': true,
        'analog:port-out': true
    };

    function print_netlist() {
        if (netlist.length > 0) {
            var clist = [];
            for (var i = 0; i < netlist.length; i += 1) {
                var type = netlist[i][0];
                if (type in dont_print) continue;
                var connections = netlist[i][1];
                var props = netlist[i][2];
                clist.push(type + " (" + props.name + "): " + JSON.stringify(connections) + " " + JSON.stringify(props));
            }
            console.log(clist.join('\n'));
            console.log(clist.length.toString() + ' devices');
        }
    }
    exports.print_netlist = print_netlist;

    function Schematic(div, jade) {
        this.jade = jade;
        this.status = jade.status;

        this.diagram = new Diagram(this, 'jade-schematic-diagram');
        div.diagram = this.diagram;
        this.diagram.wire = undefined;
        this.diagram.new_part = undefined;

        this.diagram.grid = 8;
        this.diagram.zoom_factor = 1.25; // scaling is some power of zoom_factor
        this.diagram.zoom_min = Math.pow(this.diagram.zoom_factor, - 3);
        this.diagram.zoom_max = Math.pow(this.diagram.zoom_factor, 5);
        this.diagram.origin_min = -200; // in grids
        this.diagram.origin_max = 200;

        this.hierarchy_stack = []; // remember path when traveling up/down hierarchy

        // register event handlers
        $(this.diagram.canvas).mousemove(schematic_mouse_move).mouseover(schematic_mouse_enter).mouseout(schematic_mouse_leave).mouseup(schematic_mouse_up).mousedown(schematic_mouse_down).dblclick(schematic_double_click).keydown(schematic_key_down);

        this.toolbar = new Toolbar(this.diagram);
        this.toolbar.add_tool('undo', undo_icon, 'Undo: undo effect of previous action', diagram_undo,
            function(diagram) {
                return diagram.aspect.can_undo();
            });
        this.toolbar.add_tool('redo', redo_icon, 'redo: redo effect of next action', diagram_redo,
            function(diagram) {
               return diagram.aspect.can_redo();
            });

        function has_selections(diagram) {
            return diagram.aspect.selections();
        }
        
        this.toolbar.add_tool('cut', cut_icon, 'Cut: move selected components from diagram to the clipboard', diagram_cut, has_selections);
        this.toolbar.add_tool('copy', copy_icon, 'Copy: copy selected components into the clipboard', diagram_copy, has_selections);
        this.toolbar.add_tool('paste', paste_icon, 'Paste: copy clipboard into the diagram', diagram_paste,
            function(diagram) {
                return clipboards[diagram.editor.editor_name].length > 0;
            });
        this.toolbar.add_tool('fliph', fliph_icon, 'Flip Horizontally: flip selection horizontally', diagram_fliph, has_selections);
        this.toolbar.add_tool('flipv', flipv_icon, 'Flip Vertically: flip selection vertically', diagram_flipv, has_selections);
        this.toolbar.add_tool('rotcw', rotcw_icon, 'Rotate Clockwise: rotate selection clockwise', diagram_rotcw, has_selections);
        this.toolbar.add_tool('rotccw', rotccw_icon, 'Rotate Counterclockwise: rotate selection counterclockwise', diagram_rotccw, has_selections);
        this.toolbar.add_spacer();

        this.toolbar.add_tool('down', down_icon, 'Down in the hierarchy: view selected included module', schematic_down,
            function(diagram) {
               var selected = diagram.aspect.selected_component();
              if (selected !== undefined) return selected.module.has_aspect(Schematic.prototype.editor_name);
              else return false;
            });
        this.toolbar.add_tool('up', up_icon, 'Up in the hierarchy: return to including module', schematic_up,
            function(diagram) {
                return diagram.editor.hierarchy_stack.length > 0;
            });

        this.toolbar.add_spacer();

        // add external tools
        for (var i = 0; i < schematic_tools.length; i += 1) {
            var info = schematic_tools[i]; // [name,icon,tip,callback,enable_check]
            this.toolbar.add_tool(info[0], info[1], info[2], info[3], info[4]);
        }

        div.appendChild(this.toolbar.toolbar);

        div.appendChild(this.diagram.canvas);
        this.aspect = new Aspect('untitled', null);
        this.diagram.set_aspect(this.aspect);

        this.parts_bin = new PartsBin(this.diagram);
        div.appendChild(this.parts_bin.top_level);

    }

    Schematic.prototype.resize = function(dx, dy, selected) {
        // schematic canvas
        var e = $(this.diagram.canvas);
        e.width(dx + e.width());
        e.height(dy + e.height());

        this.parts_bin.resize(dx, dy, selected);

        // adjust diagram to reflect new size
        if (selected) this.diagram.resize();
    };

    Schematic.prototype.show = function() {
        this.diagram.resize();
        this.parts_bin.show();
    };

    Schematic.prototype.set_aspect = function(module) {
        this.diagram.set_aspect(module.aspect(Schematic.prototype.editor_name));
        this.parts_bin.show();
    };

    Schematic.prototype.redraw = function(diagram) {
        // draw new wire
        var r = diagram.wire;
        if (r) {
            diagram.c.strokeStyle = diagram.selected_style;
            diagram.draw_line(r[0], r[1], r[2], r[3], 1);
        }
    };

    function schematic_down(diagram) {
        var selected = diagram.aspect.selected_component();
        if (selected !== undefined && selected.module.has_aspect(Schematic.prototype.editor_name)) {
            var e = diagram.editor;
            e.hierarchy_stack.push(diagram.aspect.module); // remember what we were editing
            e.jade.edit(selected.module);
        }
    }

    function schematic_up(diagram) {
        var e = diagram.editor;
        if (e.hierarchy_stack.length > 0)
        // return to previous module
        e.jade.edit(e.hierarchy_stack.pop());
    }

    Schematic.prototype.editor_name = 'schematic';
    editors.push(Schematic);

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Event handling
    //
    ////////////////////////////////////////////////////////////////////////////////

    // process keystrokes, consuming those that are meaningful to us
    function schematic_key_down(event) {
        var diagram = event.target.diagram;
        var code = event.keyCode;

        if (code == 38) schematic_up(diagram); // up arrow
        else if (code == 40) schematic_down(diagram); // down arrow
        else diagram.key_down(event);

        event.preventDefault();
        return false;
    }

    function schematic_mouse_enter(event) {
        var diagram = event.target.diagram;

        // see if user has selected a new part
        if (diagram.new_part) {
            // grab incoming part, turn off selection of parts bin
            var part = diagram.new_part;
            diagram.new_part = undefined;
            part.select(false);

            // unselect everything else in the diagram, add part and select it
            diagram.unselect_all(-1);
            diagram.redraw_background(); // so we see any components that got unselected

            // start of a new action
            diagram.aspect.start_action();

            // make a clone of the component in the parts bin
            diagram.set_cursor_grid(part.component.required_grid);
            part = part.component.clone(diagram.cursor_x, diagram.cursor_y);
            part.add(diagram.aspect); // add it to aspect
            part.set_select(true);

            // and start dragging it
            diagram.drag_begin();
        }

        diagram.redraw();
        diagram.canvas.focus(); // capture key strokes
        return false;
    }

    function schematic_mouse_leave(event) {
        var diagram = event.target.diagram;

        diagram.redraw();
        return false;
    }

    function schematic_mouse_down(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        // see if user is trying to pan or zoom
        if (diagram.pan_zoom()) return false;

        // is mouse over a connection point?  If so, start dragging a wire
        var dx = Math.abs(diagram.aspect_x - diagram.cursor_x);
        var dy = Math.abs(diagram.aspect_y - diagram.cursor_y);
        var cplist = diagram.aspect.connection_points[diagram.cursor_x + ',' + diagram.cursor_y];
        if (dx <= connection_point_radius && dy <= connection_point_radius && cplist && !event.shiftKey) {
            diagram.unselect_all(-1);
            diagram.redraw_background();
            diagram.wire = [diagram.cursor_x, diagram.cursor_y, diagram.cursor_x, diagram.cursor_y];
        }
        else diagram.start_select(event.shiftKey);

        event.preventDefault();
        return false;
    }

    function schematic_mouse_move(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        if (diagram.wire) {
            // update new wire end point
            diagram.wire[2] = diagram.cursor_x;
            diagram.wire[3] = diagram.cursor_y;
            diagram.redraw();
        }
        else diagram.mouse_move();

        event.preventDefault();
        return false;
    }

    function schematic_mouse_up(event) {
        var diagram = event.target.diagram;

        // drawing a new wire
        if (diagram.wire) {
            var r = diagram.wire;
            diagram.wire = undefined;

            if (r[0] != r[2] || r[1] != r[3]) {
                // insert wire component
                diagram.aspect.start_action();
                var wire = diagram.aspect.add_wire(r[0], r[1], r[2], r[3], 0);
                wire.selected = true;
                diagram.aspect.end_action();
                diagram.redraw_background();
            }
            else diagram.redraw();
        }
        else diagram.mouse_up(event.shiftKey);

        event.preventDefault();
        return false;
    }

    function schematic_double_click(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        // see if we double-clicked a component.  If so, edit it's properties
        diagram.aspect.map_over_components(function(c) {
            if (c.edit_properties(diagram, diagram.aspect_x, diagram.aspect_y)) return true;
        });

        event.preventDefault();
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Built-in schematic components
    //
    ////////////////////////////////////////////////////////////////////////////////

    function Wire(json) {
        Component.call(this);
        this.module = wire_module; // set up properties for this component
        this.load(json);
    }
    Wire.prototype = new Component();
    Wire.prototype.constructor = Wire;
    built_in_components.wire = Wire;
    var wire_module = {
        properties: {
            "signal": {
                "type": "string",
                "label": "Signal name",
                "value": "",
                "edit": "yes"
            }
        }
    };

    var wire_distance = 2; // how close to wire counts as "near by"

    Wire.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties

        var dx = this.coords[3];
        var dy = this.coords[4];
        this.add_connection(0, 0);
        this.add_connection(dx, dy);

        // compute bounding box (expanded slightly)
        var r = [0, 0, dx, dy];
        canonicalize(r);
        r[0] -= wire_distance;
        r[1] -= wire_distance;
        r[2] += wire_distance;
        r[3] += wire_distance;
        this.bounding_box = r;
        this.update_coords(); // update bbox

        // used in selection calculations
        this.len = Math.sqrt(dx * dx + dy * dy);
    };

    // return connection point at other end of wire from specified cp
    Wire.prototype.other_end = function(cp) {
        if (this.connections[0].coincident(cp.x, cp.y)) return this.connections[1];
        else if (this.connections[1].coincident(cp.x, cp.y)) return this.connections[0];
    };

    Wire.prototype.far_end = function() {
        // one end of the wire is at x,y
        // return coords at the other end
        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0];
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];
        return [x2, y2];
    };

    Wire.prototype.move_end = function() {
        Component.prototype.move_end.call(this);

        // look for connection points that might bisect us
        this.aspect.check_connection_points(this);
    };

    Wire.prototype.add = function(aspect) {
        Component.prototype.add.call(this, aspect);

        // look for wires bisected by this wire
        this.aspect.check_wires(this);

        // look for connection points that might bisect this wire
        this.aspect.check_connection_points(this);
    };

    Wire.prototype.remove = function() {
        // removing wires is a bit tricky since bisection and reassembly
        // due to other edits will have replaced the original wire.  So
        // look for a wire between the same two end points and remove that.
        var cp1 = this.connections[0];
        var cp2 = this.connections[1];
        var cplist = this.aspect.find_connections(cp1);
        for (var i = 0; i < cplist.length; i += 1) {
            var w = cplist[i].parent;
            if (w.type == 'wire' && w.other_end(cp1).coincident(cp2.x, cp2.y)) {
                Component.prototype.remove.call(w);
                break;
            }
        }
    };

    Wire.prototype.draw = function(diagram) {
        var dx = this.coords[3];
        var dy = this.coords[4];

        this.draw_line(diagram, 0, 0, dx, dy);

        // display signal name if there is one
        var name = this.properties.signal;
        var align;
        if (name !== undefined) {
            // if wire has one unconnected end, but label there
            var ncp0 = this.connections[0].nconnections() == 1;
            var ncp1 = this.connections[1].nconnections() == 1;
            if ((ncp0 && !ncp1) || (!ncp0 && ncp1)) {
                // this is the unconnected end
                var cp = this.connections[ncp0 ? 0 : 1];
                var x = cp.offset_x;
                var y = cp.offset_y;
                if (dx === 0 || Math.abs(dy / dx) > 1) {
                    // vertical-ish wire
                    var cy = (this.bounding_box[1] + this.bounding_box[3]) / 2;
                    if (cp.offset_y > cy) {
                        align = 1;
                        y += 3;
                    } // label at bottom end
                    else {
                        align = 7;
                        y -= 3;
                    } // label at top end
                }
                else {
                    // horiztonal-ish wire
                    var cx = (this.bounding_box[0] + this.bounding_box[2]) / 2;
                    if (cp.offset_x > cx) {
                        align = 3;
                        x += 3;
                    } // label at right end
                    else {
                        align = 5;
                        x -= 3;
                    } // label at left end
                }
                this.draw_text(diagram, name, x, y, align, diagram.property_font);
            }
            else {
                // draw label at center of wire
                if (dx === 0) align = 3;
                else if (dy === 0) align = 7;
                else if (dy / dx > 0) align = 6;
                else align = 8;
                this.draw_text(diagram, name, dx >> 1, dy >> 1, align, diagram.property_font);
            }
        }
    };

    Wire.prototype.draw_icon = function(c, diagram) {
        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0];
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];

        c.draw_line(diagram, this.coords[0], this.coords[1], x2, y2);
    };

    // compute distance between x,y and nearest point on line
    // http://www.allegro.cc/forums/thread/589720
    Wire.prototype.distance = function(x, y) {
        var dx = this.transform_x(this.coords[3], this.coords[4]); // account for rotation
        var dy = this.transform_y(this.coords[3], this.coords[4]);
        var D = Math.abs((x - this.coords[0]) * dy - (y - this.coords[1]) * dx) / this.len;
        return D;
    };

    // does mouse click fall on this component?
    Wire.prototype.near = function(x, y) {
        // crude check: (x,y) within expanded bounding box of wire
        // final check: distance to nearest point on line is small
        if (this.inside(x, y) && this.distance(x, y) <= wire_distance) return true;
        return false;
    };

    Wire.prototype.select_rect = function(s) {
        this.was_previously_selected = this.selected;

        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0]; // account for rotation
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];
        if (this.inside(this.coords[0], this.coords[1], s) || this.inside(x2, y2, s)) this.set_select(true);
    };

    // if connection point cp bisects the
    // wire represented by this compononent, return true
    Wire.prototype.bisect_cp = function(cp) {
        var x = cp.x;
        var y = cp.y;

        // crude check: (x,y) within expanded bounding box of wire
        // final check: ensure point isn't an end point of the wire
        if (this.inside(x, y) && this.distance(x, y) < 1 && !this.connections[0].coincident(x, y) && !this.connections[1].coincident(x, y)) return true;
        return false;
    };

    // if some connection point of component c bisects the
    // wire represented by this compononent, return that
    // connection point.  Otherwise return null.
    Wire.prototype.bisect = function(c) {
        if (c === undefined) return;
        for (var i = c.connections.length - 1; i >= 0; i -= 1) {
            var cp = c.connections[i];
            if (this.bisect_cp(cp)) return cp;
        }
        return null;
    };

    Wire.prototype.propagate_label = function(label) {
        // wires "conduct" their label to the other end
        // don't worry about relabeling a cp, it won't recurse!
        this.connections[0].propagate_label(label);
        this.connections[1].propagate_label(label);
    };

    Wire.prototype.label_connections = function(prefix) {
        // wires don't participate in this
    };

    Wire.prototype.netlist = function(prefix) {
        // no netlist entry for wires
        return undefined;
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Parts bin
    //
    ////////////////////////////////////////////////////////////////////////////////

    var part_w = 42; // size of a parts bin compartment
    var part_h = 42;

    function PartsBin(diagram) {
        this.diagram = diagram;

        this.top_level = document.createElement('div');
        this.top_level.className = 'jade-parts-bin';
        this.top_level.parts_bin = this;

        this.lib_select = document.createElement('select');
        this.lib_select.className = 'jade-parts-select';
        //this.lib_select.style.width = '120px';
        this.top_level.appendChild(this.lib_select);

        var parts_bin = this; // for closure
        $(this.lib_select).change(function() {
            parts_bin.update_modules();
        });

        this.parts_list = document.createElement('div');
        this.parts_list.className = 'jade-parts-list';
        this.top_level.appendChild(this.parts_list);

        this.parts = {}; // lib:module => Part
    }

    PartsBin.prototype.resize = function(dx, dy, selected) {
        var e = $(this.parts_list);
        e.height(dy + e.height());
    };

    PartsBin.prototype.show = function() {
        // remove existing list of libraries from select
        var options = this.lib_select.options;
        for (var i = options.length - 1; i >= 0; i -= 1) {
            options.remove(i);
        }

        // add existing libraries as options for select
        var libs = Object.keys(libraries);
        libs.sort();
        build_select(libs, libs[0], this.lib_select);

        this.update_modules();
    };

    // update list of modules for selected library
    PartsBin.prototype.update_modules = function() {
        // remove old parts from parts list
        $(this.parts_list).empty();

        // create a part for each module, add to parts list
        var lname = this.lib_select.value;
        if (lname) {
            var mlist = Object.keys(libraries[lname].modules);
            mlist.sort();
            for (var i = 0; i < mlist.length; i += 1) {
                var m = mlist[i];
                var mname = lname + ':' + m;

                // check cache, create Part if new module
                var part = this.parts[mname];
                if (part === undefined) {
                    part = new Part(this.diagram);
                    this.parts[mname] = part;
                    part.set_component(make_component([mname, [0, 0, 0]]));
                }

                this.parts_list.appendChild(part.canvas);

                // incorporate any recent edits to the icon
                part.component.compute_bbox();
                part.rescale();
                part.redraw();

                // add handlers here since any old handlers were
                // removed if part was removed from parts_list
                // at some earlier point
                $(part.canvas).mouseover(part_enter).mouseout(part_leave).mousedown(part_mouse_down).mouseup(part_mouse_up);
            }
        }
    };

    // one instance will be created for each part in the parts bin
    function Part(diagram) {
        this.diagram = diagram;
        this.aspect = undefined;
        this.selected = false;

        // set up canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'jade-part jade-tool jade-tool-enabled';
        this.canvas.style.cursor = 'default';
        this.canvas.part = this;
        this.canvas.width = part_w;
        this.canvas.height = part_h;

        this.property_font = '5pt sans-serif'; // point size for Component property text
        this.annotation_font = '6pt sans-serif'; // point size for diagram annotations
    }

    Part.prototype.rescale = function() {
        // figure out scaling and centering of parts icon
        var b = this.component.bounding_box;
        if (b[0] == Infinity) b = [-1, - 1, 1, 1]; // deal with empty icons

        var dx = b[2] - b[0];
        var dy = b[3] - b[1];
        this.scale = Math.min(part_w / (1.1 * Math.abs(dx)), part_h / (1.1 * Math.abs(dy)), 0.8);
        this.origin_x = b[0] + dx / 2.0 - part_w / (2.0 * this.scale);
        this.origin_y = b[1] + dy / 2.0 - part_h / (2.0 * this.scale);
    };

    Part.prototype.set_component = function(component) {
        this.component = component;
    };

    Part.prototype.redraw = function() {
        var c = this.canvas.getContext('2d');
        this.c = c;

        // paint background color
        c.clearRect(0, 0, part_w, part_h);

        if (this.component) this.component.draw(this);
    };

    Part.prototype.select = function(which) {
        this.selected = which;
        this.redraw();
    };

    Part.prototype.update_connection_point = function(cp, old_location) {
        // no connection points in the parts bin
    };

    Part.prototype.moveTo = function(x, y) {
        this.c.moveTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    Part.prototype.lineTo = function(x, y) {
        this.c.lineTo((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    Part.prototype.draw_line = function(x1, y1, x2, y2, width) {
        var c = this.c;
        c.lineWidth = width * this.scale;
        c.beginPath();
        c.moveTo((x1 - this.origin_x) * this.scale, (y1 - this.origin_y) * this.scale);
        c.lineTo((x2 - this.origin_x) * this.scale, (y2 - this.origin_y) * this.scale);
        c.stroke();
    };

    Part.prototype.draw_arc = function(x, y, radius, start_radians, end_radians, anticlockwise, width, filled) {
        var c = this.c;
        c.lineWidth = width * this.scale;
        c.beginPath();
        c.arc((x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale, Math.max(1, radius * this.scale),
        start_radians, end_radians, anticlockwise);
        if (filled) c.fill();
        else c.stroke();
    };

    Part.prototype.draw_text = function(text, x, y, size) {
        // most text not displayed for the parts icon
    };

    Part.prototype.draw_text_important = function(text, x, y, font) {
        var c = this.c;

        // scale font size appropriately
        var s = font.match(/\d+/)[0];
        s = Math.max(2, Math.round(s * this.scale));
        c.font = font.replace(/\d+/, s.toString());

        c.fillStyle = 'rgb(0,0,0)';
        c.fillText(text, (x - this.origin_x) * this.scale, (y - this.origin_y) * this.scale);
    };

    function part_enter(event) {
        var part = event.target.part;

        var tip = part.component.module.properties.tool_tip;
        if (tip !== undefined) tip = tip.value;
        else tip = part.component.type;
        tip += ': drag onto diagram to insert';

        part.diagram.message(tip);
        return false;
    }

    function part_leave(event) {
        var part = event.target.part;

        part.diagram.message('');
        return false;
    }

    function part_mouse_down(event) {
        var part = event.target.part;

        part.select(true);
        part.diagram.new_part = part;
        return false;
    }

    function part_mouse_up(event) {
        var part = event.target.part;

        part.select(false);
        part.diagram.new_part = undefined;
        return false;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Icon aspect
    //
    //////////////////////////////////////////////////////////////////////

    var icon_tools = [];
    exports.icon_tools = icon_tools;

    function Icon(div, jade) {
        this.jade = jade;
        this.status = jade.status;

        this.diagram = new Diagram(this, 'jade-icon-diagram');
        div.diagram = this.diagram;

        this.diagram.grid = 8;
        this.diagram.zoom_factor = 1.25; // scaling is some power of zoom_factor
        this.diagram.zoom_min = Math.pow(this.diagram.zoom_factor, 1);
        this.diagram.zoom_max = Math.pow(this.diagram.zoom_factor, 10);
        this.diagram.origin_min = -64; // in grids
        this.diagram.origin_max = 64;

        // register event handlers
        $(this.diagram.canvas).mouseover(icon_mouse_enter).mouseout(icon_mouse_leave).mousemove(icon_mouse_move).mousedown(icon_mouse_down).mouseup(icon_mouse_up).dblclick(icon_double_click).keydown(icon_key_down);

        this.toolbar = new Toolbar(this.diagram);
        this.toolbar.add_tool('undo', undo_icon, 'Undo: undo effect of previous action', diagram_undo,
            function(diagram) {
                return diagram.aspect.can_undo();
            });
        this.toolbar.add_tool('redo', redo_icon, 'redo: redo effect of next action', diagram_redo,
            function(diagram) {
                return diagram.aspect.can_redo();
            });

        function has_selections(diagram) {
            return diagram.aspect.selections();
        }
        
        this.toolbar.add_tool('cut', cut_icon, 'Cut: move selected components from diagram to the clipboard', diagram_cut, has_selections);
        this.toolbar.add_tool('copy', copy_icon, 'Copy: copy selected components into the clipboard', diagram_copy, has_selections);
        this.toolbar.add_tool('paste', paste_icon, 'Paste: copy clipboard into the diagram', diagram_paste,
            function(diagram) {
               return clipboards[diagram.editor.editor_name].length > 0;
            });
        this.toolbar.add_tool('fliph', fliph_icon, 'Flip Horizontally: flip selection horizontally', diagram_fliph, has_selections);
        this.toolbar.add_tool('flipv', flipv_icon, 'Flip Vertically: flip selection vertically', diagram_flipv, has_selections);
        this.toolbar.add_tool('rotcw', rotcw_icon, 'Rotate Clockwise: rotate selection clockwise', diagram_rotcw, has_selections);
        this.toolbar.add_tool('rotccw', rotccw_icon, 'Rotate Counterclockwise: rotate selection counterclockwise', diagram_rotccw, has_selections);

        this.toolbar.add_spacer();

        // add tools for creating icon components
        this.modes = {};
        this.modes.select = this.toolbar.add_tool('select', select_icon, 'Select mode', icon_select);
        this.set_mode('select');
        this.modes.line = this.toolbar.add_tool('line', line_icon, 'Icon line mode', icon_line);
        this.modes.arc = this.toolbar.add_tool('arc', arc_icon, 'Icon arc mode', icon_arc);
        this.modes.circle = this.toolbar.add_tool('circle', circle_icon, 'Icon circle mode', icon_circle);
        this.modes.text = this.toolbar.add_tool('text', text_icon, 'Icon text mode', icon_text);
        this.modes.terminal = this.toolbar.add_tool('terminal', terminal_icon, 'Icon terminal mode', icon_terminal);
        this.modes.property = this.toolbar.add_tool('property', property_icon, 'Icon property mode', icon_property);

        this.toolbar.add_spacer();

        // add external tools
        for (var i = 0; i < icon_tools.length; i += 1) {
            var info = icon_tools[i]; // [name,icon,tip,callback,enable_check]
            this.toolbar.add_tool(info[0], info[1], info[2], info[3], info[4]);
        }

        div.appendChild(this.toolbar.toolbar);

        div.appendChild(this.diagram.canvas);
        this.aspect = new Aspect('untitled', null);
        this.diagram.set_aspect(this.aspect);
    }

    Icon.prototype.resize = function(dx, dy, selected) {
        // schematic canvas
        var e = $(this.diagram.canvas);
        e.width(dx + e.width());
        e.height(dy + e.height());

        // adjust diagram to reflect new size
        if (selected) this.diagram.resize();
    };

    Icon.prototype.show = function() {
        this.diagram.canvas.focus(); // capture key strokes
        this.diagram.resize();
    };

    Icon.prototype.set_aspect = function(module) {
        this.diagram.set_aspect(module.aspect(Icon.prototype.editor_name));
    };

    Icon.prototype.editor_name = 'icon';
    editors.push(Icon);

    Icon.prototype.redraw = function(diagram) {
        // draw our own grid-quantized cursor
        var editor = diagram.editor;
        if (editor.mode != 'select') {
            // "X" marks the spot
            var x = diagram.cursor_x;
            var y = diagram.cursor_y;
            diagram.c.strokeStyle = diagram.normal_style;
            diagram.draw_line(x - 2, y - 2, x + 2, y + 2, 0.1);
            diagram.draw_line(x + 2, y - 2, x - 2, y + 2, 0.1);

            diagram.c.textAlign = 'left';
            diagram.c.textBaseline = 'middle';
            diagram.c.fillStyle = diagram.normal_style;
            diagram.draw_text(editor.mode, x + 4, y, diagram.property_font);
        }
    };

    var icon_prompts = {
        'select': 'Click component to select, click and drag on background for area select',
        'line': 'Click and drag to draw line',
        'arc': 'Click and drag to draw chord, then click again to set radius',
        'circle': 'Click at center point, drag to set radisu',
        'text': 'Click to insert text',
        'terminal': 'Click to insert terminal',
        'property': 'Click to insert property tag'
    };

    Icon.prototype.set_mode = function(mode) {
        this.mode = mode;
        this.start_x = undefined;

        if (this.drag_callback) {
            this.drag_callback(undefined, undefined, 'abort');
            this.diagram.aspect.end_action();
            this.drag_callback = undefined;
        }

        var c = built_in_components[mode];
        this.diagram.set_cursor_grid(c ? c.prototype.required_grid : 1);
        if (mode == 'select') this.diagram.canvas.style.cursor = 'auto';
        else
        // for component modes, we'll draw our own cursor in mouse_move
        this.diagram.canvas.style.cursor = 'none';

        // adjust className for mode tools to create visual indication
        for (var m in this.modes) {
            $(this.modes[m]).toggleClass('icon-tool-selected', mode == m);
        }

        this.status.nodeValue = icon_prompts[mode];
    };

    function icon_select(diagram) {
        diagram.editor.set_mode('select');
    }

    function icon_line(diagram) {
        diagram.editor.set_mode('line');
    }

    function icon_arc(diagram) {
        diagram.editor.set_mode('arc');
    }

    function icon_circle(diagram) {
        diagram.editor.set_mode('circle');
    }

    function icon_text(diagram) {
        diagram.editor.set_mode('text');
    }

    function icon_terminal(diagram) {
        diagram.editor.set_mode('terminal');
    }

    function icon_property(diagram) {
        diagram.editor.set_mode('property');
    }

    var select_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQw8MgDpr0TVMzB25zlfaH4nGA4oiV1vum1wur7abE0ermpsaoNrwTatTKkI6WnlEQAADs=';

    var line_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQb8MhJq704V6At79QHSuJYgmeXamvWYu8Vj2AEADs=';

    var arc_icon = 'data:image/gif;base64,R0lGODlhEAAQAIcAAEhISE5OTlFRUVdXV1paWmBgYGNjY2ZmZnh4eH5+foGBgY2NjY6OjpOTk5ycnKioqKurq7GxsbKysrS0tLe3t7i4uLq6ur6+vsDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAABgALAAAAAAQABAAAAhHADEIHEiwoMGDBQEIQBABYcEKDAQEaODQYIIBEyoSlCDggcaBFwhA+CjwQgAKJDFEMJASgwIHLQnEtJBywYKUFA60LNByYEAAOw==';

    var circle_icon = 'data:image/x-icon;base64,AAABAAEAEBAAAAEAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAF4AAACyAAAA5QAAAPoAAADlAAAAsgAAAF4AAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAANIAAAC9AAAAWgAAABkAAAACAAAAGQAAAFoAAAC9AAAA0gAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAHwAAAP8AAACbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHoAAAD/AAAADwAAAAAAAAAAAAAABwAAANIAAAB6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnAAAANEAAAAHAAAAAAAAAF4AAAC9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC9AAAAXgAAAAAAAACyAAAAWgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWQAAALMAAAAAAAAA5QAAABkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAADmAAAAAAAAAPoAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAA+gAAAAAAAADlAAAAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAOYAAAAAAAAAsgAAAFoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFkAAACzAAAAAAAAAF4AAAC9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC9AAAAXgAAAAAAAAAHAAAA0gAAAJoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB7AAAA0gAAAAcAAAAAAAAAAAAAAA4AAAD/AAAAewAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACbAAAA/wAAACAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAANEAAAC9AAAAWQAAABgAAAACAAAAGAAAAFkAAAC9AAAA0gAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAXgAAALMAAADmAAAA+gAAAOYAAACzAAAAXgAAAAcAAAAAAAAAAAAAAAAAAAAA';

    var text_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQz8MhJq5UAXYsA2JWXgVInkodnalunnZtXqpc7weE3rZUp/rpbcEebsXJBWY32u/yOKEkEADs=';

    var property_icon = '{P}'; // just text

    var terminal_icon = 'data:image/x-icon;base64,AAABAAEAEBAAAAEAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAACNAAAA4gAAAPoAAADiAAAAjQAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAADsAAAA/gAAACUAAAACAAAAJQAAAKUAAADrAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACNAAAAxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gAAAI0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4gAAACUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAADiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPoAAAACAAAAAAAAAAAAAAD+AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP4AAADiAAAAJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAOIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjQAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMQAAABsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAADrAAAAxAAAACQAAAACAAAAJAAAAP8AAADqAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAI0AAADiAAAA+gAAAOIAAABsAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Event handling
    //
    ////////////////////////////////////////////////////////////////////////////////

    function icon_mouse_enter(event) {
        var diagram = event.target.diagram;

        diagram.canvas.focus(); // capture key strokes
        diagram.editor.status.nodeValue = icon_prompts[diagram.editor.mode];

        event.preventDefault();
        return false;
    }

    function icon_mouse_leave(event) {
        var diagram = event.target.diagram;

        diagram.editor.status.nodeValue = '';

        event.preventDefault();
        return false;
    }

    // process keystrokes, consuming those that are meaningful to us
    function icon_key_down(event) {
        var diagram = event.target.diagram;
        var code = event.keyCode;

        if (code == 32) diagram.editor.set_mode('select');
        else diagram.key_down(event);

        event.preventDefault();
        return false;
    }

    function icon_mouse_down(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        // see if user is trying to pan or zoom
        if (diagram.pan_zoom()) return false;

        var editor = diagram.editor;
        var cx = diagram.cursor_x;
        var cy = diagram.cursor_y;

        if (editor.mode == 'arc2') {
            // okay, we just captured third point for arc, finish up
            // and return to 'arc' mode
            editor.drag_callback(cx, cy, 'done');
            diagram.aspect.end_action();
            editor.drag_callback = undefined;
            editor.mode = 'arc';
        }
        else if (editor.mode != 'select') {
            editor.start_x = cx;
            editor.start_y = cy;
        }
        else diagram.start_select(event.shiftKey);

        event.preventDefault();
        return false;
    }

    function icon_new_component(diagram) {
        var editor = diagram.editor;

        diagram.unselect_all(-1);
        diagram.redraw_background();

        diagram.aspect.start_action();
        var c = make_component([editor.mode, [editor.start_x, editor.start_y, 0]]);
        c.add(diagram.aspect);
        c.selected = true;

        editor.drag_callback = function(x, y, action) {
            if (action == 'abort' || !c.drag_callback(x, y, action)) {
                c.remove();
                diagram.redraw_background();
            }
            else diagram.redraw();
        };

        editor.start_x = undefined;
    }

    function icon_mouse_move(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        var editor = diagram.editor;

        if (editor.start_x !== undefined) icon_new_component(diagram);

        if (editor.drag_callback) editor.drag_callback(diagram.cursor_x, diagram.cursor_y, editor.mode);
        else diagram.mouse_move();

        event.preventDefault();
        return false;
    }

    function icon_mouse_up(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        var editor = diagram.editor;

        if (editor.start_x !== undefined) icon_new_component(diagram);

        if (editor.drag_callback) {
            var cx = diagram.cursor_x;
            var cy = diagram.cursor_y;

            if (editor.mode == 'arc') {
                editor.drag_callback(cx, cy, 'arc');
                editor.mode = 'arc2'; // now capture third point
            }
            else {
                editor.drag_callback(cx, cy, 'done');
                diagram.aspect.end_action();
                editor.drag_callback = undefined;
            }
        }
        else diagram.mouse_up(event.shiftKey);

        event.preventDefault();
        return false;
    }

    function icon_double_click(event) {
        var diagram = event.target.diagram;
        diagram.event_coords(event);

        // see if we double-clicked a component.  If so, edit it's properties
        diagram.aspect.map_over_components(function(c) {
            if (c.edit_properties(diagram, diagram.aspect_x, diagram.aspect_y)) return true;
        });

        event.preventDefault();
        return false;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Built-in icon components
    //
    //////////////////////////////////////////////////////////////////////

    // line  (arc if you pull at the middle to provide a third point?)
    function Line(json) {
        Component.call(this);
        this.module = line_module;
        this.load(json);
    }
    Line.prototype = new Component();
    Line.prototype.constructor = Line;
    Line.prototype.required_grid = 1;
    built_in_components.line = Line;
    var line_module = {
        properties: {}
    };

    var line_distance = 2; // how close to line counts as "near by"

    Line.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties
        this.setup_bbox();
    };

    Line.prototype.setup_bbox = function() {
        var dx = this.coords[3];
        var dy = this.coords[4];

        // compute bounding box (expanded slightly)
        var r = [0, 0, dx, dy];
        canonicalize(r);
        r[0] -= line_distance;
        r[1] -= line_distance;
        r[2] += line_distance;
        r[3] += line_distance;
        this.bounding_box = r;
        this.update_coords(); // update bbox

        // used in selection calculations
        this.len = Math.sqrt(dx * dx + dy * dy);
    };

    Line.prototype.drag_callback = function(x, y, action) {
        this.coords[3] = x - this.coords[0];
        this.coords[4] = y - this.coords[1];

        if (action == 'done') {
            // remove degenerate line from diagram
            if (this.coords[3] === 0 && this.coords[4] == 0) return false;
            else this.setup_bbox();
        }
        return true;
    };

    Line.prototype.draw = function(diagram) {
        var dx = this.coords[3];
        var dy = this.coords[4];

        this.draw_line(diagram, 0, 0, dx, dy);
    };

    Line.prototype.draw_icon = function(c, diagram) {
        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0];
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];

        c.draw_line(diagram, this.coords[0], this.coords[1], x2, y2);
    };

    // compute distance between x,y and nearest point on line
    // http://www.allegro.cc/forums/thread/589720
    Line.prototype.distance = function(x, y) {
        var dx = this.transform_x(this.coords[3], this.coords[4]); // account for rotation
        var dy = this.transform_y(this.coords[3], this.coords[4]);
        var D = Math.abs((x - this.coords[0]) * dy - (y - this.coords[1]) * dx) / this.len;
        return D;
    };

    // does mous eclick fall on this component?
    Line.prototype.near = function(x, y) {
        // crude check: (x,y) within expanded bounding box of wire
        // final check: distance to nearest point on line is small
        if (this.inside(x, y) && this.distance(x, y) <= line_distance) return true;
        return false;
    };

    Line.prototype.select_rect = function(s) {
        this.was_previously_selected = this.selected;

        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0]; // account for rotation
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];
        if (this.inside(this.coords[0], this.coords[1], s) || this.inside(x2, y2, s)) this.set_select(true);
    };

    // line  (arc if you pull at the middle to provide a third point?)
    function Arc(json) {
        Component.call(this);
        this.module = arc_module;
        this.load(json);
    }
    Arc.prototype = new Component();
    Arc.prototype.constructor = Arc;
    Arc.prototype.required_grid = 1;
    built_in_components.arc = Arc;
    var arc_module = {
        properties: {}
    };

    Arc.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties
        this.setup_bbox();
    };

    Arc.prototype.setup_bbox = function() {
        var dx = this.coords[3];
        var dy = this.coords[4];

        var ex = this.coords[5];
        var ey = this.coords[6];

        if (ex === undefined) {
            // we're just a line without the third point!
            Line.prototype.setup_bbox.call(this);
        }
        else {
            // compute bounding box enclosing all three points
            var r = [0, 0, dx, dy];
            canonicalize(r);
            if (ex < r[0]) r[0] = ex;
            else if (ex > r[2]) r[2] = ex;
            if (ey < r[1]) r[1] = ey;
            else if (ey > r[3]) r[3] = ey;
            canonicalize(r);
            this.bounding_box = r;
            this.update_coords(); // update bbox
        }
    };

    Arc.prototype.drag_callback = function(x, y, action) {
        if (action == 'arc') {
            this.coords[3] = x - this.coords[0];
            this.coords[4] = y - this.coords[1];
        }
        else {
            this.coords[5] = x - this.coords[0];
            this.coords[6] = y - this.coords[1];
        }

        if (action == 'done') {
            // remove degenerate arc from diagram
            if (this.coords[3] === 0 && this.coords[4] == 0) return false;
            this.setup_bbox();
        }
        return true;
    };

    // draw circle segment from coords[0,1] to coords[3,4] that passes through coords[5,6]
    Arc.prototype.draw = function(diagram) {
        var x3, y3;
        if (this.coords[5] !== undefined) {
            x3 = this.coords[5];
            y3 = this.coords[6];
        }
        else {
            x3 = this.coords[3]; // no third point, pretend it's a line
            y3 = this.coords[4];
        }

        this.draw_arc(diagram, 0, 0, this.coords[3], this.coords[4], x3, y3);
    };

    Arc.prototype.draw_icon = function(c, diagram) {
        var x2 = this.transform_x(this.coords[3], this.coords[4]) + this.coords[0];
        var y2 = this.transform_y(this.coords[3], this.coords[4]) + this.coords[1];

        var x3, y3;
        if (this.coords[5] !== undefined) {
            x3 = this.transform_x(this.coords[5], this.coords[6]) + this.coords[0];
            y3 = this.transform_y(this.coords[5], this.coords[6]) + this.coords[1];
        }
        else {
            x3 = x2;
            y3 = y2;
        }

        c.draw_arc(diagram, this.coords[0], this.coords[1], x2, y2, x3, y3);
    };

    var text_alignments = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];

    // crude estimate of bbox for aligned text
    function text_bbox(text, align) {
        var h = 8;
        var w = 4 * (text ? text.length : 0);
        var bbox = [0, 0, 0, 0];

        var position = align.split('-');

        // adjust for alignment
        var vertical = position[0];
        if (vertical == 'top') {
            bbox[1] = 0;
            bbox[3] = h;
        }
        else if (vertical == 'center') {
            bbox[1] = -h / 2;
            bbox[3] = h / 2;
        }
        else {
            bbox[1] = -h;
            bbox[3] = 0;
        }

        var horizontal = position[1] || position[0];
        if (horizontal == 'left') {
            bbox[0] = 0;
            bbox[2] = w;
        }
        else if (horizontal == 'center') {
            bbox[0] = -w / 2;
            bbox[2] = w / 2;
        }
        else {
            bbox[0] = -w;
            bbox[2] = 0;
        }

        return bbox;
    }

    // text, aligned around reference point
    function Text(json) {
        Component.call(this);
        this.module = text_module;
        this.load(json);
    }
    Text.prototype = new Component();
    Text.prototype.constructor = Text;
    Text.prototype.required_grid = 1;
    built_in_components.text = Text;
    var text_module = {
        properties: {
            "text": {
                "type": "string",
                "label": "Text",
                "value": "???",
                "edit": "yes"
            },
            "font": {
                "type": "string",
                "label": "CSS Font",
                "value": "6pt sans-serif",
                "edit": "yes"
            },
            "align": {
                "type": "menu",
                "label": "Alignment",
                "value": "center-left",
                "edit": "yes",
                "choices": text_alignments
            }
        }
    };

    Text.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties

        this.bounding_box = text_bbox(this.properties.text, this.properties.align);
        this.update_coords();
    };

    Text.prototype.drag_callback = function(x, y, action) {
        // nothing to do
        return true;
    };

    Text.prototype.draw = function(diagram) {
        // "+" marks the reference point for the property
        this.draw_line(diagram, - 1, 0, 1, 0);
        this.draw_line(diagram, 0, - 1, 0, 1);

        var align = text_alignments.indexOf(this.properties.align);
        this.draw_text(diagram, this.properties.text, 0, 0, align, this.properties.font);
    };

    Text.prototype.draw_icon = function(c, diagram) {
        // need to adjust alignment accounting for our rotation
        var align = text_alignments.indexOf(this.properties.align);
        align = aOrient[this.coords[2] * 9 + align];

        c.draw_text(diagram, this.properties.text, this.coords[0], this.coords[1], align, this.properties.font);
    };

    Text.prototype.edit_properties = function(diagram, x, y) {
        return Component.prototype.edit_properties.call(this, diagram, x, y, function(c) {
            c.bounding_box = text_bbox(c.properties.text, c.properties.align);
            c.update_coords();
        });
    };

    // circle: center point + radius
    function Circle(json) {
        Component.call(this);
        this.module = circle_module;
        this.load(json);
    }
    Circle.prototype = new Component();
    Circle.prototype.constructor = Circle;
    Circle.prototype.required_grid = 1;
    built_in_components.circle = Circle;
    var circle_module = {
        properties: {}
    };

    Circle.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties
        this.setup_bbox();
    };

    Circle.prototype.setup_bbox = function() {
        var radius = this.coords[3];
        this.bounding_box = [-radius, - radius, radius, radius];
        this.update_coords(); // update bbox
    };

    Circle.prototype.drag_callback = function(x, y, action) {
        var dx = x - this.coords[0];
        var dy = y - this.coords[1];
        this.coords[3] = Math.sqrt(dx * dx + dy * dy);

        if (action == 'done') {
            // remove degenerate circle from diagram
            if (this.coords[3] === 0) return false;
            else this.setup_bbox();
        }
        return true;
    };

    Circle.prototype.draw = function(diagram) {
        this.draw_circle(diagram, 0, 0, this.coords[3], false);
    };

    Circle.prototype.draw_icon = function(c, diagram) {
        c.draw_circle(diagram, this.coords[0], this.coords[1], this.coords[3], false);
    };

    // display of one or more module properties, aligned to reference point
    function Property(json) {
        Component.call(this);
        this.module = property_module;
        this.load(json);
    }
    Property.prototype = new Component();
    Property.prototype.constructor = Property;
    Property.prototype.required_grid = 1;
    built_in_components.property = Property;
    var property_module = {
        properties: {
            "format": {
                "type": "string",
                "label": "Format",
                "value": "{???}",
                "edit": "yes"
            },
            "align": {
                "type": "menu",
                "label": "Alignment",
                "value": "center-left",
                "edit": "yes",
                "choices": text_alignments
            }
        }
    };

    Property.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties

        this.bounding_box = text_bbox(this.properties.format, this.properties.align);
        this.update_coords();
    };

    Property.prototype.drag_callback = function(x, y, action) {
        // nothing to do
        return true;
    };

    Property.prototype.draw = function(diagram) {
        // "+" marks the reference point for the property
        this.draw_line(diagram, - 1, 0, 1, 0);
        this.draw_line(diagram, 0, - 1, 0, 1);

        var align = text_alignments.indexOf(this.properties.align);
        this.draw_text(diagram, this.properties.format || '-no format-', 0, 0, align, diagram.property_font);
    };

    Property.prototype.draw_icon = function(c, diagram) {
        // replace occurences of {pname} in format with the
        // corresponding property value
        var s = this.properties.format || '-no format-';
        for (var p in c.properties) {
            var v = c.properties[p] || '';
            s = s.replace(new RegExp("\\{" + p + "\\}", "gm"), v);
        }

        // need to adjust alignment accounting for our rotation
        var align = text_alignments.indexOf(this.properties.align);
        align = aOrient[this.coords[2] * 9 + align];

        c.draw_text(diagram, s, this.coords[0], this.coords[1], align, diagram.property_font);
    };

    Property.prototype.edit_properties = function(diagram, x, y) {
        return Component.prototype.edit_properties.call(this, diagram, x, y, function(c) {
            c.bounding_box = text_bbox(c.properties.format, c.properties.align);
            c.update_coords();
        });
    };

    // icon terminal (turns into connection point when module is instantiated)
    function Terminal(json) {
        Component.call(this);
        this.module = terminal_module;
        this.load(json);
    }
    Terminal.prototype = new Component();
    Terminal.prototype.constructor = Terminal;
    Terminal.prototype.required_grid = 8;
    built_in_components.terminal = Terminal;
    var terminal_module = {
        properties: {
            "name": {
                "type": "string",
                "label": "Terminal name",
                "value": "???",
                "edit": "yes"
            },
            "line": {
                "type": "menu",
                "label": "Draw line",
                "value": "yes",
                "edit": "yes",
                "choices": ["yes", "no"]
            }
        }
    };

    Terminal.prototype.load = function(json) {
        this.type = json[0];
        this.coords = json[1];
        this.properties = json[2] || {};

        this.default_properties(); // add any missing properties

        this.bounding_box = [-connection_point_radius, - connection_point_radius,
        8 + connection_point_radius, connection_point_radius];
        this.update_coords();
    };

    Terminal.prototype.drag_callback = function(x, y, action) {
        // nothing to do
        return true;
    };

    Terminal.prototype.draw = function(diagram) {
        this.draw_circle(diagram, 0, 0, connection_point_radius, false);
        if (this.properties.line != 'no') this.draw_line(diagram, 0, 0, 8, 0);
        this.draw_text(diagram, this.properties.name, connection_point_radius - 4, 0, 5, diagram.property_font);
    };

    Terminal.prototype.draw_icon = function(c, diagram) {
        if (this.properties.line != 'no') {
            var x1 = this.coords[0];
            var y1 = this.coords[1];
            var x2 = this.transform_x(8, 0) + this.coords[0];
            var y2 = this.transform_y(8, 0) + this.coords[1];

            c.draw_line(diagram, x1, y1, x2, y2);
        }
    };

    Terminal.prototype.terminal_coords = function() {
        return [this.coords[0], this.coords[1], this.properties.name];
    };

    //////////////////////////////////////////////////////////////////////
    //
    // Property editor
    //
    //////////////////////////////////////////////////////////////////////

    function PropertyEditor(div, jade) {
        this.jade = jade;
        this.status = jade.status;
        this.module = undefined;

        this.table = document.createElement('table');
        this.table.className = 'jade-property-table';
        div.appendChild(this.table);
        this.build_table();
    }

    PropertyEditor.prototype.resize = function(dx, dy, selected) {};

    PropertyEditor.prototype.show = function() {};

    PropertyEditor.prototype.set_aspect = function(module) {
        this.module = module;
        this.build_table();
    };

    PropertyEditor.prototype.build_table = function() {
        var editor = this; // for closures
        var tr, td, field;

        // remove old rows from table
        $(this.table).empty();

        if (editor.module === undefined) {
            this.table.innerHTML = '<tr><td>To edit properites you must first specify a module.</td></tr>';
            return;
        }

        // header row
        tr = document.createElement('tr');
        this.table.appendChild(tr);
        tr.innerHTML = '<th>Action</th><th>Name</th><th>Label</th><th>Type</th><th>Value</th><th>Edit</th><th>Choices</th>';

        // one row for each existing property
        for (var p in editor.module.properties) {
            var props = editor.module.properties[p];
            tr = document.createElement('tr');
            this.table.appendChild(tr);

            // action
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_button('delete', function(event) {
                // remove property, rebuild table
                editor.module.remove_property(event.target.pname);
                editor.build_table();
            });
            field.pname = p; // so callback knows what to delete
            td.appendChild(field);

            // name (not editable)
            td = document.createElement('td');
            tr.appendChild(td);
            td.appendChild(document.createTextNode(p));

            // label
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_input('text', 10, props.label || props.name);
            field.pname = p;
            field.props = props;
            $(field).change(function(event) {
                var v = event.target.value.trim();
                if (v === '') {
                    v = event.target.pname; // default label is property name
                    event.target.value = v;
                }
                event.target.props.label = v;
                editor.module.set_modified(true);
            });
            td.appendChild(field);

            // type
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_select(['string', 'menu'], props.type || 'string');
            field.props = props;
            $(field).change(function(event) {
                event.target.props.type = event.target.value;
                editor.module.set_modified(true);
            });
            td.appendChild(field);

            // value
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_input('text', 10, props.value || '');
            field.props = props;
            $(field).change(function(event) {
                event.target.props.value = event.target.value.trim();
                editor.module.set_modified(true);
            });
            td.appendChild(field);

            // edit
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_select(['yes', 'no'], props.edit || 'yes');
            field.props = props;
            $(field).change(function(event) {
                event.target.props.edit = event.target.value;
                editor.module.set_modified(true);
            });
            td.appendChild(field);

            // choices
            td = document.createElement('td');
            tr.appendChild(td);
            field = build_input('text', 15, props.choices ? props.choices.join() : '');
            field.props = props;
            $(field).change(function(event) {
                var vlist = event.target.value.split(',');
                for (var i = 0; i < vlist.length; i += 1) {
                    vlist[i] = vlist[i].trim();
                }
                event.target.props.choices = vlist;
                event.target.value = vlist.join();
                editor.module.set_modified(true);
            });
            td.appendChild(field);
        }

        // last row for adding properties
        tr = document.createElement('tr');
        this.table.appendChild(tr);

        var fields = {};
        fields.action = build_button('add', function(event) {
            // validate then add new property
            var name = fields.name.value.trim();
            if (name === '') alert('Please enter a name for the new property');
            else if (name in editor.module.properties) alert('Oops, duplicate property name!');
            else {
                var p = {};
                p.label = fields.label.value.trim() || name;
                p.type = fields.type.value;
                p.value = fields.value.value.trim();
                p.edit = fields.edit.value;
                var vlist = fields.choices.value.split(',');
                for (var i = 0; i < vlist.length; i += 1) {
                    vlist[i] = vlist[i].trim();
                }
                p.choices = vlist;
                editor.module.set_property(name, p);

                editor.build_table();
            }
        });
        fields.name = build_input('text', 10, '');
        fields.label = build_input('text', 10, '');
        fields.type = build_select(['string', 'menu'], 'string');
        fields.value = build_input('text', 10, '');
        fields.edit = build_select(['yes', 'no'], 'yes');
        fields.choices = build_input('text', 15, '');

        for (var f in fields) {
            td = document.createElement('td');
            tr.appendChild(td);
            td.appendChild(fields[f]);
        }
    };

    PropertyEditor.prototype.editor_name = 'properties';
    editors.push(PropertyEditor);

    //////////////////////////////////////////////////////////////////////
    //
    // utilities
    //
    //////////////////////////////////////////////////////////////////////

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Parse numbers in engineering notation
    //
    ///////////////////////////////////////////////////////////////////////////////

    // convert string argument to a number, accepting usual notations
    // (hex, octal, binary, decimal, floating point) plus engineering
    // scale factors (eg, 1k = 1000.0 = 1e3).
    // return default if argument couldn't be interpreted as a number
    function parse_number(x, default_v) {
        var m;

        m = x.match(/^\s*([\-+]?)0x([0-9a-fA-F]+)\s*$/); // hex
        if (m) return parseInt(m[1] + m[2], 16);

        m = x.match(/^\s*([\-+]?)0b([0-1]+)\s*$/); // binary
        if (m) return parseInt(m[1] + m[2], 2);

        m = x.match(/^\s*([\-+]?)0([0-7]+)\s*$/); // octal
        if (m) return parseInt(m[1] + m[2], 8);

        m = x.match(/^\s*[\-+]?[0-9]*(\.([0-9]+)?)?([eE][\-+]?[0-9]+)?\s*$/); // decimal, float
        if (m) return parseFloat(m[0]);

        m = x.match(/^\s*([\-+]?[0-9]*(\.([0-9]+)?)?)(a|A|f|F|g|G|k|K|m|M|n|N|p|P|t|T|u|U)\s*$/); // decimal, float
        if (m) {
            var result = parseFloat(m[1]);
            var scale = m[4];
            if (scale == 'P') result *= 1e15; // peta
            else if (scale == 't' || scale == 'T') result *= 1e12; // tera
            else if (scale == 'g' || scale == 'G') result *= 1e9; // giga
            else if (scale == 'M') result *= 1e6; // mega
            else if (scale == 'k' || scale == 'K') result *= 1e3; // kilo
            else if (scale == 'm') result *= 1e-3; // milli
            else if (scale == 'u' || scale == 'U') result *= 1e-6; // micro
            else if (scale == 'n' || scale == 'N') result *= 1e-9; // nano
            else if (scale == 'p') result *= 1e-12; // pico
            else if (scale == 'f' || scale == 'F') result *= 1e-15; // femto
            else if (scale == 'a' || scale == 'A') result *= 1e-18; // atto
            return result;
        }

        return (default_v || NaN);
    }
    exports.parse_number = parse_number; // make it easy to call from outside

    // try to parse a number and generate an alert if there was a syntax error
    function parse_number_alert(s) {
        var v = parse_number(s, undefined);

        if (v === undefined) throw 'The string \"' + s + '\" could not be interpreted as an integer, a floating-point number or a number using engineering notation. Sorry, expressions are not allowed in this context.';

        return v;
    }
    exports.parse_number_alert = parse_number_alert; // make it easy to call from outside

    function engineering_notation(n, nplaces, trim) {
        if (n === 0) return '0';
        if (n === undefined) return 'undefined';
        if (trim === undefined) trim = true;

        var sign = n < 0 ? -1 : 1;
        var log10 = Math.log(sign * n) / Math.LN10;
        var exp = Math.floor(log10 / 3); // powers of 1000
        var mantissa = sign * Math.pow(10, log10 - 3 * exp);

        // keep specified number of places following decimal point
        var mstring = (mantissa + sign * 0.5 * Math.pow(10, - nplaces)).toString();
        var mlen = mstring.length;
        var endindex = mstring.indexOf('.');
        if (endindex != -1) {
            if (nplaces > 0) {
                endindex += nplaces + 1;
                if (endindex > mlen) endindex = mlen;
                if (trim) {
                    while (mstring.charAt(endindex - 1) == '0') endindex -= 1;
                    if (mstring.charAt(endindex - 1) == '.') endindex -= 1;
                }
            }
            if (endindex < mlen) mstring = mstring.substring(0, endindex);
        }

        switch (exp) {
        case -5:
            return mstring + "f";
        case -4:
            return mstring + "p";
        case -3:
            return mstring + "n";
        case -2:
            return mstring + "u";
        case -1:
            return mstring + "m";
        case 0:
            return mstring;
        case 1:
            return mstring + "K";
        case 2:
            return mstring + "M";
        case 3:
            return mstring + "G";
        }

        // don't have a good suffix, so just print the number
        return n.toPrecision(nplaces);
    }
    exports.engineering_notation = engineering_notation;

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Source parsing
    //
    ///////////////////////////////////////////////////////////////////////////////

    // argument is a string describing the source's value (see comments for details)
    // source types: dc,step,square,triangle,sin,pulse,pwl,pwl_repeating

    // returns an object with the following attributes:
    //   fun -- name of source function
    //   args -- list of argument values
    //   value(t) -- compute source value at time t
    //   inflection_point(t) -- compute time after t when a time point is needed
    //   period -- repeat period for periodic sources (0 if not periodic)

    function parse_source(v) {
        // generic parser: parse v as either <value> or <fun>(<value>,...)
        var src = {};
        src.period = 0; // Default not periodic
        src.value = function(t) {
            return 0;
        }; // overridden below
        src.inflection_point = function(t) {
            return undefined;
        }; // may be overridden below

        var m = v.match(/^\s*(\w+)\s*\(([^\)]*)\)\s*$/); // parse f(arg,arg,...)
        if (m) {
            src.fun = m[1];
            src.args = m[2].split(/\s*,\s*/).map(parse_number_alert);
        }
        else {
            src.fun = 'dc';
            src.args = [parse_number_alert(v)];
        }
        //console.log(src.fun + ': ' + src.args);

        // post-processing for constant sources
        // dc(v)
        if (src.fun == 'dc') {
            var val = arg_value(src.args, 0, 0);
            src.args = [val];
            src.value = function(t) {
                return val;
            }; // closure
        }

        // post-processing for impulse sources
        // impulse(height,width)
        else if (src.fun == 'impulse') {
            var h = arg_value(src.args, 0, 1); // default height: 1
            var w = Math.abs(arg_value(src.args, 2, 1e-9)); // default width: 1ns
            src.args = [h, w]; // remember any defaulted values
            pwl_source(src, [0, 0, w / 2, h, w, 0], false);
        }

        // post-processing for step sources
        // step(v_init,v_plateau,t_delay,t_rise)
        else if (src.fun == 'step') {
            var v1 = arg_value(src.args, 0, 0); // default init value: 0V
            var v2 = arg_value(src.args, 1, 1); // default plateau value: 1V
            var td = Math.max(0, arg_value(src.args, 2, 0)); // time step starts
            var tr = Math.abs(arg_value(src.args, 3, 1e-9)); // default rise time: 1ns
            src.args = [v1, v2, td, tr]; // remember any defaulted values
            pwl_source(src, [td, v1, td + tr, v2], false);
        }

        // post-processing for square wave
        // square(v_init,v_plateau,freq,duty_cycle)
        else if (src.fun == 'square') {
            var v1 = arg_value(src.args, 0, 0); // default init value: 0V
            var v2 = arg_value(src.args, 1, 1); // default plateau value: 1V
            var freq = Math.abs(arg_value(src.args, 2, 1)); // default frequency: 1Hz
            var duty_cycle = Math.min(100, Math.abs(arg_value(src.args, 3, 50))); // default duty cycle: 0.5
            src.args = [v1, v2, freq, duty_cycle]; // remember any defaulted values

            var per = freq === 0 ? Infinity : 1 / freq;
            var t_change = 0.01 * per; // rise and fall time
            var t_pw = 0.01 * duty_cycle * 0.98 * per; // fraction of cycle minus rise and fall time
            pwl_source(src, [0, v1, t_change, v2, t_change + t_pw,
            v2, t_change + t_pw + t_change, v1, per, v1], true);
        }

        // post-processing for triangle
        // triangle(v_init,v_plateua,t_period)
        else if (src.fun == 'triangle') {
            var v1 = arg_value(src.args, 0, 0); // default init value: 0V
            var v2 = arg_value(src.args, 1, 1); // default plateau value: 1V
            var freq = Math.abs(arg_value(src.args, 2, 1)); // default frequency: 1s
            src.args = [v1, v2, freq]; // remember any defaulted values

            var per = freq === 0 ? Infinity : 1 / freq;
            pwl_source(src, [0, v1, per / 2, v2, per, v1], true);
        }

        // post-processing for pwl and pwlr sources
        // pwl[r](t1,v1,t2,v2,...)
        else if (src.fun == 'pwl' || src.fun == 'pwl_repeating') {
            pwl_source(src, src.args, src.fun == 'pwl_repeating');
        }

        // post-processing for pulsed sources
        // pulse(v_init,v_plateau,t_delay,t_rise,t_fall,t_width,t_period)
        else if (src.fun == 'pulse') {
            var v1 = arg_value(src.args, 0, 0); // default init value: 0V
            var v2 = arg_value(src.args, 1, 1); // default plateau value: 1V
            var td = Math.max(0, arg_value(src.args, 2, 0)); // time pulse starts
            var tr = Math.abs(arg_value(src.args, 3, 1e-9)); // default rise time: 1ns
            var tf = Math.abs(arg_value(src.args, 4, 1e-9)); // default rise time: 1ns
            var pw = Math.abs(arg_value(src.args, 5, 1e9)); // default pulse width: "infinite"
            var per = Math.abs(arg_value(src.args, 6, 1e9)); // default period: "infinite"
            src.args = [v1, v2, td, tr, tf, pw, per];

            var t1 = td; // time when v1 -> v2 transition starts
            var t2 = t1 + tr; // time when v1 -> v2 transition ends
            var t3 = t2 + pw; // time when v2 -> v1 transition starts
            var t4 = t3 + tf; // time when v2 -> v1 transition ends

            pwl_source(src, [t1, v1, t2, v2, t3, v2, t4, v1, per, v1], true);
        }

        // post-processing for sinusoidal sources
        // sin(v_offset,v_amplitude,freq_hz,t_delay,phase_offset_degrees)
        else if (src.fun == 'sin') {
            var voffset = arg_value(src.args, 0, 0); // default offset voltage: 0V
            var va = arg_value(src.args, 1, 1); // default amplitude: -1V to 1V
            var freq = Math.abs(arg_value(src.args, 2, 1)); // default frequency: 1Hz
            src.period = 1.0 / freq;

            var td = Math.max(0, arg_value(src.args, 3, 0)); // default time delay: 0sec
            var phase = arg_value(src.args, 4, 0); // default phase offset: 0 degrees
            src.args = [voffset, va, freq, td, phase];

            phase /= 360.0;

            // return value of source at time t
            src.value = function(t) { // closure
                if (t < td) return voffset + va * Math.sin(2 * Math.PI * phase);
                else return voffset + va * Math.sin(2 * Math.PI * (freq * (t - td) + phase));
            };

            // return time of next inflection point after time t
            src.inflection_point = function(t) { // closure
                if (t < td) return td;
                else return undefined;
            };
        }

        // object has all the necessary info to compute the source value and inflection points
        src.dc = src.value(0); // DC value is value at time 0
        return src;
    }
    exports.parse_source = parse_source;

    function pwl_source(src, tv_pairs, repeat) {
        var nvals = tv_pairs.length;
        if (repeat) src.period = tv_pairs[nvals - 2]; // Repeat period of source
        if (nvals % 2 == 1) nvals -= 1; // make sure it's even!

        if (nvals <= 2) {
            // handle degenerate case
            src.value = function(t) {
                return nvals == 2 ? tv_pairs[1] : 0;
            };
            src.inflection_point = function(t) {
                return undefined;
            };
        }
        else {
            src.value = function(t) { // closure
                if (repeat)
                // make time periodic if values are to be repeated
                t = Math.fmod(t, tv_pairs[nvals - 2]);
                var last_t = tv_pairs[0];
                var last_v = tv_pairs[1];
                if (t > last_t) {
                    var next_t, next_v;
                    for (var i = 2; i < nvals; i += 2) {
                        next_t = tv_pairs[i];
                        next_v = tv_pairs[i + 1];
                        if (next_t > last_t) // defend against bogus tv pairs
                        if (t < next_t) return last_v + (next_v - last_v) * (t - last_t) / (next_t - last_t);
                        last_t = next_t;
                        last_v = next_v;
                    }
                }
                return last_v;
            };
            src.inflection_point = function(t) { // closure
                if (repeat)
                // make time periodic if values are to be repeated
                t = Math.fmod(t, tv_pairs[nvals - 2]);
                for (var i = 0; i < nvals; i += 2) {
                    var next_t = tv_pairs[i];
                    if (t < next_t) return next_t;
                }
                return undefined;
            };
        }
    }

    // helper function: return args[index] if present, else default_v
    function arg_value(args, index, default_v) {
        var result = args[index];
        if (result === undefined) result = default_v;
        return result;
    }

    // we need fmod in the Math library!
    Math.fmod = function(numerator, denominator) {
        var quotient = Math.floor(numerator / denominator);
        return numerator - quotient * denominator;
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Signal parsing
    //
    ////////////////////////////////////////////////////////////////////////////////

    // see if two signal lists are the same
    function signal_equals(s1, s2) {
        if (s1.length == s2.length) {
            for (var i = 0; i < s1.length; i += 1) {
                if (s1[i] != s2[i]) return false;
            }
            return true;
        }
        return false;
    }

    // parse string into an array of symbols
    //  sig_list := sig[,sig]...
    //  sig := symbol
    //      := sig#count         -- replicate sig specified number of times
    //      := sig[start:stop:step]   -- expands to sig[start],sig[start+step],...,sig[end]
    function parse_signal(s) {
        function parse_sig(sig) {
            var m;

            // replicated signal: sig#number
            m = sig.match(/(.*)#\s*(\d+)$/);
            if (m) {
                var expansion = parse_sig(m[1].trim());
                var count = parseInt(m[2],10);
                if (isNaN(count)) return [sig];
                var result = [];
                while (count > 0) {
                    result.push.apply(result, expansion);
                    count -= 1;
                }
                return result;
            }

            // iterated signal: sig[start:stop:step] or sig[start:stop]
            m = sig.match(/(.*)\[\s*(\-?\d+)\s*:\s*(\-?\d+)\s*(:\s*(\-?\d+)\s*)?\]$/);
            if (m) {
                var expansion = parse_sig(m[1].trim());
                var start = parseInt(m[2],10);
                var end = parseInt(m[3],10);
                var step = Math.abs(parseInt(m[5],10) || 1);
                if (end < start) step = -step;

                var result = [];
                while (true) {
                    for (var k = 0; k < expansion.length; k += 1) {
                        result.push(expansion[k] + '[' + start.toString() + ']');
                    }
                    start += step;
                    if ((step > 0 && start > end) || (step < 0 && start < end)) break;
                }
                return result;
            }

            // what's left is treated as a simple signal name
            if (sig) return [sig];
            else return [];
        }

        // parse list of signal names
        var result = [];
        if (s !== undefined) {
            var sig_list = s.split(',');
            for (var i = 0; i < sig_list.length; i += 1) {
                var expansion = parse_sig(sig_list[i].trim());
                result.push.apply(result, expansion); // extend result with all the elements of expansion
            }
        }
        return result;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // sadly javascript has no modules, so we have to fake it
    //
    //////////////////////////////////////////////////////////////////////

    return exports;
}());
