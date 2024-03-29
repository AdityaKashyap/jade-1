//////////////////////////////////////////////////////////////////////////////
//
//  Gate-level simulation
//
//////////////////////////////////////////////////////////////////////////////

// Copyright (C) 2013 Massachusetts Institute of Technology
// Chris Terman

// this must be loaded *after* jade.js

var gatesim = (function() {

    // handler for gate simulation tool
    function gate_sim(diagram) {
        // use modules in the gates library as the leafs
        var mlist = [];
        for (var m in jade.libraries.gates.modules) {
            mlist.push('gates:' + m);
        }
        // plus some standard analog parts used in all schematics
        mlist.push('analog:port-in');
        mlist.push('analog:port-out');
        mlist.push('analog:s');
        mlist.push('analog:g');
        mlist.push('analog:vdd');
        mlist.push('analog:v');

        var netlist = diagram.netlist(mlist);
        if (netlist.length === 0) return;

        var network = new Network();
        try {
            network.load_netlist(netlist);
        }
        catch (e) {
            if (typeof e != 'string') throw e;
            alert("Error while loading netlist:\n\n" + e);
            return;
        }

        var tstop_lbl = 'Stop Time (seconds)';
        var module = diagram.aspect.module;
        var fields = {};
        fields[tstop_lbl] = jade.build_input('text', 10, module.properties.gatesim_tstop);
        var content = jade.build_table(fields);

        diagram.dialog('Gate-level Simulation', content, function() {
            // retrieve parameters, remember for next time
            module.set_property('gatesim_tstop', fields[tstop_lbl].value);
            var tstop = jade.parse_number_alert(module.properties.gatesim_tstop);
            if (tstop === undefined) return;

            var progress = document.createElement('div');
            progress.className = 'jade-progress';

            // set up progress bar
            var d = document.createElement('div');
            d.className = 'jade-progress-wrapper';
            progress.appendChild(d);
            progress.bar = document.createElement('div');
            progress.bar.className = 'jade-progress-bar';
            $(progress.bar).width('0%');
            d.appendChild(progress.bar);

            // allow user to stop simulation
            var stop = jade.build_button('Stop', function(event) {
                event.target.progress.stop_requested = true;
            });
            stop.progress = progress;
            progress.appendChild(stop);

            progress.update_interval = 250; // ms between progress bar updates
            progress.stop_requested = false;
            progress.finish = simulation_results; // what to do when done!

            diagram.window('Progress', progress); // display progress bar

            // off to do the heavy lifting...
            network.sim_init(progress, tstop);
            try {
                network.simulate(new Date().getTime() + network.progress.update_interval);
            }
            catch (e) {
                if (typeof e == 'string') progress.finish(e, progress);
                else throw e;
            }
        });
    }

    function simulation_results(netlist, progress) {
        var diagram = progress.win.diagram;
        var probes = progress.probes;
        var probe_names = progress.probe_names;

        jade.window_close(progress.win); // all done with progress bar

        if (typeof results == 'string') alert("Error during simulation:\n\n" + results);
        /*
	    else if (results === undefined)
		alert("Sorry, no results from simulation to plot!");
	    */
        else {}
    }

    var gatesim_icon = 'data:image/gif;base64,R0lGODlhEAAQALMAAAAAAIAAAACAAICAAAAAgIAAgACAgMDAwICAgP8AAAD/AP//AAAA//8A/wD//////yH5BAEAAAcALAAAAAAQABAAAAQ38MhJq70YaFzBe5uljd8XUkjqlWbGttf6AvFrjpTMAimS27zazCcZaXY8oqS30vQyzhRnKb1EAAA7';

    // add to schematic toolbar
    jade.schematic_tools.push(['gatesim', gatesim_icon, 'Gate-level simulation', gate_sim]);

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Network
    //
    //////////////////////////////////////////////////////////////////////////////

    function Network() {
        this.N = 0;
        this.node_map = {};
        this.devices = []; // list of devices
        this.device_map = {}; // name -> device
    }

    // return Node object for specified name, create if necessary
    Network.prototype.node = function(name) {
        var n = this.node_map[name];
        if (n === undefined) {
            n = new Node(name, this);
            this.node_map[name] = n;
            this.N += 1;
        }
        return n;
    };

    // these components are extracted but don't represent a gatesim device
    var ignored_components = ["analog:port-in", "analog:port-out", "analog:port-inout", "analog:s"];

    // load circuit from JSON netlist: [[device,[connections,...],{prop: value,...}]...]
    Network.prototype.load_netlist = function(netlist) {
        // process each component in the JSON netlist (see schematic.js for format)
        var counts = {};
        var n,d;
        for (var i = netlist.length - 1; i >= 0; i -= 1) {
            var component = netlist[i];
            var type = component[0];
            var connections = component[1];
            var properties = component[2];

            // ignore components not relevant to creating simulation devices
            if (ignored_components.indexOf(type) != -1) continue;
            counts[type] = (counts[type] || 0) + 1;

            // convert node names to Nodes
            for (var c in connections) {
                connections[c] = this.node(connections[c]);
            }

            // process the component
            var name = properties.name;
            if (type in logic_gates) {
                var info = logic_gates[type]; // [input-list,output,table]
                // build input and output lists using terminal names
                // in info array
                var inputs = [];
                for (var j = 0; j < info[0].length; j += 1) {
                    inputs.push(connections[info[0][j]]);
                }
                // create a new device
                d = new LogicGate(this, type, name, info[2], inputs, connections[info[1]], properties, true);
                this.devices.push(d);
                this.device_map[name] = d;
            }
            else if (type == 'gates:dlatch') {}
            else if (type == 'gates:dlatchn') {}
            else if (type == 'gates:dreg') {}
            else if (type == 'analog:g') {
                // gnd node -- drive with a 0-input OR gate (output = 0)
                n = connections.gnd;
                if (n.drivers.length > 0) continue; // already handled this one
                n.v = V0;
                this.devices.push(new LogicGate(this, type, name, OrTable, [], n, properties, true));
            }
            else if (type == 'analog:vdd') {
                // power supply node -- drive with a 0-input AND gate (output = 1)
                n = connections.vdd;
                if (n.drivers.length > 0) continue; // already handled this one
                n.v = V1;
                this.devices.push(new LogicGate(this, type, name, AndTable, [], n, properties, true));
            }
            else if (type == 'analog:v') {
                n = connections.nplus; // hmmm.
                if (n.drivers.length > 0) continue; // already handled this one

                // fix me...
                n.v = V1;
                this.devices.push(new LogicGate(this, type, name, AndTable, [], n, properties, true));
            }
            else throw 'Unrecognized gate: ' + type;
        }

        // give each Node a chance to finalize itself
        for (n in this.node_map) {
            this.node_map[n].finalize();
        }

        var msg = this.N.toString() + ' nodes';
        for (d in counts) {
            msg += ', ' + counts[d].toString() + ' ' + d.split(':')[1];
        }
        console.log(msg);
    };

    // initialize for simulation, queue initial events
    Network.prototype.sim_init = function(progress, tstop) {
        this.progress = progress;
        this.tstop = tstop;
        this.event_queue = null;
        this.time = 0;

        // queue initial events
        for (var i = this.devices.length - 1; i >= 0; i -= 1) {
            this.devices[i].initialize();
        }
    };

    // tupdate is the wall-clock time at which we should take a quick coffee break
    // to let the UI update
    Network.prototype.simulate = function(tupdate) {
        var ecount = 0;
        if (!this.progress.stop_requested) // halt when user clicks stop
        while (this.time < this.tstop && this.event_queue !== null) {
            var event = this.event_queue;
            this.event_queue = event.remove_event(this.event_queue);
            event.node.process_event(event, false);

            // check for coffee break every 1000 events
            if (++ecount < 1000) continue;
            else ecount = 0;

            var t = new Date().getTime();
            if (t >= tupdate) {
                // update progress bar
                var completed = Math.round(100 * this.time / this.tstop);
                $(this.progress.bar).width(completed.toString() + '%');

                // a brief break in the action to allow progress bar to update
                // then pick up where we left off
                var nl = this;
                setTimeout(function() {
                    try {
                        nl.simulate(t + nl.progress.update_interval);
                    }
                    catch (e) {
                        if (typeof e == 'string') nl.progress.finish(e, nl.progress);
                        else throw e;
                    }
                }, 1);

                // our portion of the work is done
                return;
            }
        }

        // simulation complete or interrupted
        this.progress.finish(this, this.progress);
    };

    Network.prototype.add_event = function(t, type, node, v) {
        var event = new Event(t, type, node, v);
        this.event_queue = merge_with_queue(this.event_queue, event);
        return event;
    };

    Network.prototype.remove_event = function(event) {
        this.event_queue = event.remove(this.event_queue);
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Events
    //
    //////////////////////////////////////////////////////////////////////////////

    var CONTAMINATE = 0; // values chosen so that C events sort before P events
    var PROPAGATE = 1;

    function Event(t, type, node, v) {
        this.t = t; // time of event
        this.type = type; // CONTAMINATE, PROPAGATE
        this.node = node;
        this.v = v;

        this.parent = null; // left-ist tree from Knuth
        this.left = null;
        this.right = null;
        this.distance = 1;
    }

    // keeps events on the queue ordered by time.  Events at the same time are ordered
    // by C events before P events, then in order of addition to the queue.
    Event.prototype.before = function(ev2) {
        if (this.t < ev2.t) return true;
        else if (this.t == ev2.t) return this.type < ev2.type; // C events before P events
        else return false;
    };

    Event.prototype.remove = function(queue) {
        if (this.parent === null) queue = this.left;
        else {
            // patch ourselves out of tree hierarchy, update distances
            if (this.parent.left == this) this.parent.left = this.left;
            else this.parent.right = this.left;
            update_distance(this.parent);
        }

        // take care of newly-orphaned children
        if (this.left !== null) this.left.parent = this.parent;
        if (this.right !== null) queue = merge_with_queue(queue, this.right);

        return queue;
    };

    // adjust distance from leafs all the way up the tree, rearranging
    // children to keep the shortest path on the right branch
    function update_distance(e) {
        while (e !== null) {
            var ldist = (e.left === null) ? 0 : e.left.distance;
            var rdist = (e.right === null) ? 0 : e.right.distance;
            // maintain right child as having minimum distance
            if (ldist < rdist) {
                var temp = e.left;
                e.left = e.right;
                e.right = temp;
                rdist = ldist;
            }
            e.distance = 1 + rdist;
            e = e.parent;
        }
    }

    // queue is earliest event, children are later events.
    // put event q in its place
    function merge_with_queue(queue, q) {
        if (queue === null) {
            q.parent = null;
            return q;
        }

        var p = queue;
        var parent = null;

        // merge this Q into tree.  If P has a later time
        // Q will take its place and we'll continue the merge with
        // this event.  Otherwise just keep passing Q down the tree,
        // using the right branch since it's guaranteed to be the
        // shortest.
        while (true) {
            // Q is earlier, so swap places with current node
            if (q.before(p)) {
                var temp = p;
                p = q;
                q = temp;
                p.parent = parent;
                if (parent === null) queue = p;
                else parent.right = p;
            }
            // got to a leaf node so add Q as right child and
            // then update distances on the way back up
            if (p.right === null) {
                p.right = q;
                q.parent = p;
                update_distance(p);
                return queue;
            }
            // keep descending
            parent = p;
            p = p.right;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Node
    //
    //////////////////////////////////////////////////////////////////////////////

    var V0 = 0; // node values
    var V1 = 1;
    var VX = 2;
    var VZ = 3;

    var c_slope = 0; // F/terminal of interconnect capacitance
    var c_intercept = 0; // F of interconnect capacitance

    function Node(name, network) {
        this.name = name;
        this.network = network;

        this.drivers = []; // devices which want to control value of this node
        this.driver = undefined; // device which controls value of this node
        this.fanouts = []; // devices with this node as an input
        this.capacitance = 0; // nodal capacitance

        this.v = VX;
        this.history = []; // list of events that changed node value
        this.cd_event = undefined; // contamination delay event for this node
        this.pd_event = undefined; // propagation delay event for this node

        // for timing analysis
        this.clock = false; // is this node connected to clock input of state device
        this.timing_info = undefined; // min tCD, max tPD for this node
        this.in_progress = false; // flag to catch combinational cycles
    }

    Node.prototype.add_fanout = function(device) {
        if (this.fanouts.indexOf(device) == -1) this.fanouts.push(device);
    };

    Node.prototype.add_driver = function(device) {
        this.drivers.push(device);
    };

    Node.prototype.process_event = function(event, force) {
        // update event pointers
        if (event == this.cd_event) this.cd_event === undefined;
        else if (event == this.pd_event) this.pd_event === undefined;

        if (this.v != event.v || force) {
            // remember history of changes
            event.old_v = this.v;
            this.history.push(event);
            this.v = event.v;

            // let fanouts know our value changed
            for (var i = this.fanouts.length - 1; i >= 0; i -= 1) {
                this.fanouts[i].process_event(event);
            }
        }
    };

    Node.prototype.finalize = function() {
        var i,d;
        
        if (this.drivers === undefined || this.driver !== undefined) return; // already finalized

        // if no explicit capacitance has been supplied, estimate
        // interconnect capacitance
        var ndrivers = this.drivers.length;
        var nfanouts = this.fanouts.length;
        if (ndrivers === 0 && nfanouts > 0) throw 'Node ' + this.name + ' is not connected to any output.';
        if (this.capacitance === 0) this.capacitance = c_intercept + c_slope * (ndrivers + nfanouts);

        // add capacitances from drivers and fanout connections
        for (i = 0; i < ndrivers; i += 1) {
            this.capacitance += this.drivers[i].capacitance(this);
        }
        for (i = 0; i < nfanouts; i += 1) {
            this.capacitance += this.fanouts[i].capacitance(this);
        }

        // if there is only 1 driver and it's not a tristate output
        // then that device is the driver for this node
        if (ndrivers == 1) {
            d = this.drivers[0];
            if (!d.tristate(this)) {
                this.driver = d;
                this.drivers = undefined;
                return;
            }
        }

        // handle tristates and multiple drivers by adding a special BUS
        // device that computes value from all the drivers
        var inputs = [];
        for (i = 0; i < ndrivers; i += 1) {
            d = this.drivers[i];
            if (!d.tristate(this)) {
                // shorting together non-tristate outputs, so complain
                var msg = 'Node ' + this.name + ' connects to more than one non-tristate output.  See devices: \n';
                for (var j = 0; j < ndrivers; j += 1) {
                    msg += this.drivers[j].name + '\n';
                }
                throw msg;
            }
            // cons up a new node and have this device drive it
            var n = new Node(this.network, this.name + '%' + i.toString());
            n.capacitance = this.capacitance; // each driver has to drive all the capacitance
            inputs.push(n);
            d.change_output_node(this, n);
            n.driver = d;
        }

        // now add the BUS device to drive the current node
        this.driver = new LogicGate(this.network, 'BUS', this.name + '%bus', BusTable, inputs, this, {}, true);
        this.drivers = null; // finalization complete
        this.network.devices.push(this.driver);
    };

    // schedule contamination event for this node
    Node.prototype.c_event = function(tcd) {
        var t = this.network.time + tcd;

        // remove any pending propagation event that happens after tcd
        if (this.pd_event && this.pd_event.t >= t) {
            this.network.remove_event(this.pd_event);
            this.pd_event = undefined;
        }

        // if we've already scheduled a contamination event for an earlier
        // time, make the conservative assumption that node will become
        // contaminated at the earlier possible time, i.e., keep the
        // earlier of the two contamination events
        if (this.cd_event) {
            if (this.cd_event.t <= t) return;
            this.network.remove_event(this.cd_event);
        }

        this.cd_event = this.network.add_event(t, CONTAMINATE, this, VX);
    };

    // schedule propagation event for this node
    Node.prototype.p_event = function(tpd, v, drive, lenient) {
        var t = this.network.time + tpd + drive * this.capacitance;

        if (this.pd_event) {
            if (lenient && this.pd_event.v == v && t >= this.pd_event.t) return;
            this.network.remove_event(this.pd_event);
        }

        this.pd_event = this.network.add_event(t, PROPAGATE, this, v);
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Logic gates
    //
    ///////////////////////////////////////////////////////////////////////////////

    // it's tables all the way down
    // use current input as index into current table to get new table
    // repeat until all inputs have been consumed
    // final value is given by current_table[4]

    var LTable = [];
    LTable.push(LTable, LTable, LTable, LTable, 0); // always "0"
    var HTable = [];
    HTable.push(HTable, HTable, HTable, HTable, 1); // always "1"
    var XTable = [];
    XTable.push(XTable, XTable, XTable, XTable, 2); // always "X"
    var ZTable = [];
    ZTable.push(ZTable, ZTable, ZTable, ZTable, 3); // always "Z"
    var SelectTable = [LTable, HTable, XTable, XTable, 2]; // select this input
    var Select2ndTable = [SelectTable, SelectTable, SelectTable, SelectTable, 2]; // select second input
    var Select3rdTable = [Select2ndTable, Select2ndTable, Select2ndTable, Select2ndTable, 2]; // select third input
    var Select4thTable = [Select3rdTable, Select3rdTable, Select3rdTable, Select3rdTable, 2]; // select fourth input
    var Ensure0Table = [LTable, XTable, XTable, XTable, 2]; // must be 0
    var Ensure1Table = [XTable, HTable, XTable, XTable, 2]; // must be 1
    var EqualTable = [Ensure0Table, Ensure1Table, XTable, XTable, 2]; // this == next

    // tristate bus resolution
    // produces "Z" if all inputs are "Z"
    // produces "1" if one input is "1" and other inputs are "1" or "Z"
    // produces "0" if one input is "0" and other inputs are "0" or "Z"
    // produces "X" otherwise
    var BusTable = [];
    var Bus0Table = [];
    var Bus1Table = [];
    BusTable.push(Bus0Table, Bus1Table, XTable, BusTable, 3);
    Bus0Table.push(Bus0Table, XTable, XTable, Bus0Table, 0);
    Bus1Table.push(XTable, Bus1Table, XTable, Bus1Table, 1);

    // tristate buffer (node order: enable,in)
    var TristateBufferTable = [ZTable, SelectTable, XTable, XTable, 2];

    // and tables
    var AndXTable = [];
    AndXTable.push(LTable, AndXTable, AndXTable, AndXTable, 2);
    var AndTable = [];
    AndTable.push(LTable, AndTable, AndXTable, AndXTable, 1);

    // nand tables
    var NandXTable = [];
    NandXTable.push(HTable, NandXTable, NandXTable, NandXTable, 2);
    var NandTable = [];
    NandTable.push(HTable, NandTable, NandXTable, NandXTable, 0);

    // or tables
    var OrXTable = [];
    OrXTable.push(OrXTable, HTable, OrXTable, OrXTable, 2);
    var OrTable = [];
    OrTable.push(OrTable, HTable, OrXTable, OrXTable, 0);

    // nor tables
    var NorXTable = [];
    NorXTable.push(NorXTable, LTable, NorXTable, NorXTable, 2);
    var NorTable = [];
    NorTable.push(NorTable, LTable, NorXTable, NorXTable, 1);

    // xor tables
    var XorTable = [];
    var Xor1Table = [];
    XorTable.push(XorTable, Xor1Table, XTable, XTable, 0);
    Xor1Table.push(Xor1Table, XorTable, XTable, XTable, 1);
    var XnorTable = [];
    var Xnor1Table = [];
    XnorTable.push(XnorTable, Xnor1Table, XTable, XTable, 1);
    Xnor1Table.push(Xnor1Table, XnorTable, XTable, XTable, 0);

    // 2-input mux table (node order: sel,d0,d1)
    var Mux2Table = [SelectTable, Select2ndTable, EqualTable, EqualTable, 2];

    // 4-input mux table (node order: s0,s1,d0,d1,d2,d3)
    var Mux4aTable = [SelectTable, Select3rdTable, EqualTable, EqualTable, 2]; // s0 == 0
    var Mux4bTable = [Select2ndTable, Select4thTable, EqualTable, EqualTable, 2]; // s0 == 1
    var Mux4Table = [Mux4aTable, Mux4bTable, EqualTable, EqualTable, 2];

    // for each logic gate provide [input-terminal-list,output-terminal,table]
    var logic_gates = {
        'gates:and2': [['A', 'B'], 'Z', AndTable],
        'gates:and3': [['A', 'B', 'C'], 'Z', AndTable],
        'gates:and4': [['A', 'B', 'C', 'D'], 'Z', AndTable],
        'gates:buffer': [['A'], 'Z', AndTable],
        'gates:inv': [['A'], 'Z', NandTable],
        'gates:mux2': [['S', 'D0', 'D1'], 'Y', Mux2Table],
        'gates:mux4': [['S0', 'S1', 'D0', 'D1', 'D2', 'D3'], 'Y', Mux4Table],
        'gates:nand2': [['A', 'B'], 'Z', NandTable],
        'gates:nand3': [['A', 'B', 'C'], 'Z', NandTable],
        'gates:nand4': [['A', 'B', 'C', 'D'], 'Z', NandTable],
        'gates:nor2': [['A', 'B'], 'Z', NorTable],
        'gates:nor3': [['A', 'B', 'C'], 'Z', NorTable],
        'gates:nor4': [['A', 'B', 'C', 'D'], 'Z', NorTable],
        'gates:or2': [['A', 'B'], 'Z', OrTable],
        'gates:or3': [['A', 'B', 'C'], 'Z', OrTable],
        'gates:or4': [['A', 'B', 'C', 'D'], 'Z', OrTable],
        'gates:tristate': [['E', 'A'], 'Z', TristateBufferTable],
        'gates:xor2': [['A', 'B'], 'Z', XorTable],
        'gates:xnor2': [['A', 'B'], 'Z', XnorTable]
    };

    function LogicGate(network, type, name, table, inputs, output, properties, lenient) {
        this.network = network;
        this.type = type;
        this.name = name;
        this.table = table;
        this.inputs = inputs;
        this.output = output;
        this.properties = properties;
        this.lenient = lenient;

        for (var i = inputs.length - 1; i >= 0; i -= 1) {
            inputs[i].add_fanout(this);
        }
        output.add_driver(this);

        if (this.properties.cout === undefined) this.properties.cout = 0;
        if (this.properties.cin === undefined) this.properties.cin = 0;
        if (this.properties.tcd === undefined) this.properties.tcd = 0;
        if (this.properties.tpdf === undefined) this.properties.tpdf = 0;
        if (this.properties.tpdr === undefined) this.properties.tpdr = 0;
        if (this.properties.tr === undefined) this.properties.tr = 0;
        if (this.properties.tf === undefined) this.properties.tf = 0;

        var in0 = inputs[0];
        var in1 = inputs[1];
        var in2 = inputs[2];
        var in3 = inputs[3];
        var in4 = inputs[4];
        var in5 = inputs[5];
        if (inputs.length === 0) this.evaluate = function() {
            return table[4];
        };
        else if (inputs.length == 1) this.evaluate = function() {
            return table[in0.v][4];
        };
        else if (inputs.length == 2) this.evaluate = function() {
            return table[in0.v][in1.v][4];
        };
        else if (inputs.length == 3) this.evaluate = function() {
            return table[in0.v][in1.v][in2.v][4];
        };
        else if (inputs.length == 4) this.evaluate = function() {
            return table[in0.v][in1.v][in2.v][in3.v][4];
        };
        else if (inputs.length == 5) this.evaluate = function() {
            return table[in0.v][in1.v][in2.v][in3.v][in4.v][4];
        };
        else if (inputs.length == 6) this.evaluate = function() {
            return table[in0.v][in1.v][in2.v][in3.v][in4.v][in5.v][4];
        };
        else alert(name + ' is a LogicGate with more than 6 inputs!'); // shouldn't happen
    }

    LogicGate.prototype.initialize = function() {
        if (this.inputs.length === 0) {
            // gates with no inputs will produce a constant output, so
            // figure that out now and process the appropriate event
            var v = this.evaluate();
            this.output.process_event(new Event(0, PROPAGATE, this.output, v), true);
        }
    };

    LogicGate.prototype.capacitance = function(node) {
        if (this.output == node) return this.properties.cout;
        else return this.properties.cin;
    };

    // is node a tristate output of this device?
    LogicGate.prototype.tristate = function(node) {
        if (this.output == node && this.table == TristateBufferTable) return true;
        else return false;
    };

    // evaluation of output values triggered by an event on the input
    LogicGate.prototype.process_event = function(event) {
        var onode = this.output;
        var v;
        
        if (event.type == CONTAMINATE) {
            // a lenient gate won't contaminate the output under the right circumstances
            if (this.lenient) {
                v = this.evaluate();
                if (onode.pd_event === null) {
                    // no events pending and current value is same as new value
                    if (onode.cd_event === null && v == onode.v) return;
                }
                else {
                    // node is destined to have the same value as new value
                    if (v == onode.pd_event.v) return;
                }
            }

            // schedule contamination event with specified delay
            onode.c_event(this.properties.tcd);
        }
        else if (event.type == PROPAGATE) {
            v = this.evaluate();
            if (!this.lenient || v != onode.v || onode.cd_event !== null || onode.pd_event !== null) {
                var drive, tpd;
                if (v == V1) {
                    tpd = this.properties.tpdr;
                    drive = this.properties.tr;
                }
                else if (v == V0) {
                    tpd = this.properties.tpdf;
                    drive = this.properties.tf;
                }
                else {
                    tpd = Math.min(this.properties.tpdr, this.properties.tpdf);
                    drive = 0;
                }
                onode.p_event(tpd, v, drive, this.lenient);
            }
        }
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Module definition
    //
    ///////////////////////////////////////////////////////////////////////////////
    var module = {
        'Network': Network,
    };
    return module;
}());
