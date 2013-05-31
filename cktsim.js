1/////////////////////////////////////////////////////////////////////////////
//
//  Circuit simulator
//
//////////////////////////////////////////////////////////////////////////////

// Copyright (C) 2011-2013 Massachusetts Institute of Technology
// Chris Terman and Jacob White

// this must be loaded *after* jade.js

cktsim = (function() {
    
	///////////////////////////////////////////////////////////////////////////////
	//
	//  DC Analysis
	//
	//////////////////////////////////////////////////////////////////////////////

	// extend connection points to display operating point voltage
	jade.ConnectionPoint.prototype.display_voltage = function(diagram,vmap) {
	    var v = vmap[this.label];
	    if (v != undefined) {
		var label = v.toFixed(2) + 'V';
		
		// first draw some solid blocks in the background
		diagram.c.globalAlpha = 0.85;
		this.parent.draw_text(diagram,'\u2588\u2588\u2588',this.offset_x,this.offset_y,
				      4,diagram.annotation_font,diagram.background_style);
		diagram.c.globalAlpha = 1.0;

		// display the node voltage at this connection point
		this.parent.draw_text(diagram,label,this.offset_x,this.offset_y,
				      4,diagram.annotation_font,diagram.annotation_style);

		// only display each node voltage once
		delete vmap[this.label];
	    }
	}

	// extend components to display operating point branch currents
	// default behavior: nothing to display for DC analysis
	jade.Component.prototype.display_current = function(diagram,vmap) {
	    if (this.type == "analog:a") {
		// current probe
		var label = 'I(' + this.name + ')';
		var v = vmap[label];
		if (v != undefined) {
		    var i = jade.engineering_notation(v,2) + 'A';
		    this.draw_text(diagram,i,8,5,1,diagram.annotation_font,diagram.annotation_style);

		    // only display each current once
		    delete vmap[label];
		}
	    }
	}

	// callback to annotate diagram with operating point results
	function display_dc(diagram,operating_point) {
	    // make a copy of the operating_point info so we can mess with it
	    var temp = {};
	    for (var i in operating_point) temp[i] = operating_point[i];

	    // run through connection points displaying (once) the voltage
	    // for each electrical node
	    var connection_points = diagram.aspect.connection_points;
	    for (var location in connection_points)
		(connection_points[location])[0].display_voltage(diagram,temp);

	    // let components display branch current info if available
	    diagram.aspect.map_over_components(function(c) {
		    c.display_current(diagram,temp);
		});
	}

	// handler for DC analysis tool
	function dc_analysis(diagram) {
	    // remove any previous annotations
	    diagram.remove_annotations();

	    // use modules in the analog library as the leafs
	    var mlist = [];
	    for (m in jade.libraries.analog.modules) mlist.push('analog:'+m);
	    var netlist = diagram.netlist(mlist);

	    if (netlist.length > 0) {
		var ckt = new Circuit();
		if (!ckt.load_netlist(netlist)) return;

		// run the analysis
		var operating_point;
		try {
		    operating_point = ckt.dc();
		} catch (e) {
		    alert("Error during DC analysis:\n\n"+e);
		    return;
		}

		if (operating_point != undefined) {
		    // save a copy of the results for submission
		    var dc = {};
		    for (var i in operating_point) dc[i] = operating_point[i];
		    // add permanenty copy to module's properties
		    diagram.aspect.module.set_property('dc_results',dc);

		    // display results on diagram
		    diagram.add_annotation(function(diagram) {
			    display_dc(diagram,operating_point);
			});
		}
	    }
	}

	// add DC analysis to tool bar
	jade.schematic_tools.push(['DC','DC','DC Analysis',dc_analysis]);

	///////////////////////////////////////////////////////////////////////////////
	//
	//  AC Analysis
	//
	//////////////////////////////////////////////////////////////////////////////

	// return a list of [color,node_label,offset,type] for each probe in the netlist
	// type is 'voltage' or 'current'
	function find_probes(netlist) {
	    var result = [];
	    for (var i = netlist.length - 1; i >= 0; --i) {
		var component = netlist[i];
		var type = component[0];
		var connections = component[1];
		var properties = component[2];
		var offset = properties.offset;
		if (offset==undefined || offset=='') offset = '0';
		if (type == 'analog:s')
		    result.push([properties.color,connections.probe,offset,'voltage']);
		else if (type == 'analog:a')
		    result.push([properties.color,'I('+properties.name+')',offset,'current']);
	    }
	    return result;
	}

	// use a dialog to get AC analysis parameters
	function setup_ac_analysis(diagram) {
	    diagram.remove_annotations();

	    var fstart_lbl = 'Starting frequency (Hz)';
	    var fstop_lbl = 'Ending frequency (Hz)';
	    var source_name_lbl = 'Name of V or I source for ac';
    
	    // use modules in the analog library as the leafs
	    var mlist = [];
	    for (m in jade.libraries.analog.modules) mlist.push('analog:'+m);
	    var netlist = diagram.netlist(mlist);

	    if (find_probes(netlist).length == 0) {
		alert("AC Analysis: there are no voltage probes in the diagram!");
		return;
	    }

	    var module = diagram.aspect.module;
	    var fields = {};
	    fields[fstart_lbl] = jade.build_input('text',10,module.properties.ac_fstart || '10');
	    fields[fstop_lbl] = jade.build_input('text',10,module.properties.ac_fstop || '1G');
	    fields[source_name_lbl] = jade.build_input('text',10,module.properties.ac_source);

	    var content = jade.build_table(fields);

	    diagram.dialog('AC Analysis',content,function() {
		    // retrieve parameters, remember for next time
		    var ac_fstart = fields[fstart_lbl].value;
		    var ac_fstop = fields[fstop_lbl].value;
		    var ac_source = fields[source_name_lbl].value;

		    module.set_property('ac_fstart',ac_fstart);
		    module.set_property('ac_fstop',ac_fstop);
		    module.set_property('ac_source',ac_source);

		    ac_analysis(netlist,diagram,
				parse_number(ac_fstart),
				parse_number(ac_fstop),
				ac_source);
		});
	}

	// perform ac analysis
	function ac_analysis(netlist,diagram,fstart,fstop,ac_source_name) {
	    var npts = 50;

	    // use modules in the analog library as the leafs
	    var mlist = [];
	    for (m in jade.libraries.analog.modules) mlist.push('analog:'+m);
	    var netlist = diagram.netlist(mlist);

	    if (netlist.length > 0) {
		var ckt = new Circuit();
		if (!ckt.load_netlist(netlist)) return;

		var results;
		try {
		    results = ckt.ac(npts,fstart,fstop,ac_source_name);
		}
		catch (e) {
		    alert("Error during AC analysis:\n\n"+e);
		    return;
		}

		if (typeof results == 'string') 
		    this.message(results);
		else {
		    var x_values = results._frequencies_;

		    // x axis will be a log scale
		    for (var i = x_values.length - 1; i >= 0; --i)
			x_values[i] = Math.log(x_values[i])/Math.LN10;

		    // see what we need to submit.  Expecting attribute of the form
		    // submit_analyses="{'tran':[[node_name,t1,t2,t3],...],
		    //                   'ac':[[node_name,f1,f2,...],...]}"
		    var submit = diagram.getAttribute('submit_analyses');
		    if (submit && submit.indexOf('{') == 0) submit = JSON.parse(submit).ac;
		    else submit = undefined;

		    if (submit != undefined) {
			// save a copy of the results for submission
			var ac_results = {};

			// save requested values for each requested node
			for (var j = 0; j < submit.length; j++) {
			    var flist = submit[j];    // [node_name,f1,f2,...]
			    var node = flist[0];
			    var values = results[node];
			    var fvlist = [];
			    // for each requested freq, interpolate response value
			    for (var k = 1; k < flist.length; k++) {
				var f = flist[k];
				var v = interpolate(f,x_values,values);
				// convert to dB
				fvlist.push([f,v == undefined ? 'undefined' : 20.0 * Math.log(v)/Math.LN10]);
			    }
			    // save results as list of [f,response] paris
			    ac_results[node] = fvlist;
			}

			diagram.aspect.module.set_property('ac_result',ac_results);
		    }

		    // set up plot values for each node with a probe
		    var y_values = [];  // list of [color, result_array]
		    var z_values = [];  // list of [color, result_array]
		    var probes = find_probes(netlist);

		    var probe_maxv = [];
		    var probe_color = [];

		    // Check for probe with near zero transfer function and warn
		    for (var i = probes.length - 1; i >= 0; --i) {
			if (probes[i][3] != 'voltage') continue;
			probe_color[i] = probes[i][0];
			var label = probes[i][1];
			var v = results[label];
			probe_maxv[i] = array_max(v); // magnitudes always > 0
		    }
		    var all_max = array_max(probe_maxv);

		    if (all_max < 1.0e-16) {
			alert('Zero ac response, -infinity on DB scale.');
		    } else {
			for (var i = probes.length - 1; i >= 0; --i) {
			    if (probes[i][3] != 'voltage') continue;
			    if ((probe_maxv[i] / all_max) < 1.0e-10) {
				alert('Near zero ac response, remove ' + probe_color[i] + ' probe');
				return;
			    }
			}
		    }

		    for (var i = probes.length - 1; i >= 0; --i) {
			if (probes[i][3] != 'voltage') continue;
			var color = probes[i][0];
			var label = probes[i][1];
			var offset = cktsim.parse_number(probes[i][2]);

			var v = results[label];
			// convert values into dB relative to source amplitude
			var v_max = 1;
			for (var j = v.length - 1; j >= 0; --j)
			    // convert each value to dB relative to max
			    v[j] = 20.0 * Math.log(v[j]/v_max)/Math.LN10;
			y_values.push([color,offset,v]);

			var v = results[label+'_phase'];
			z_values.push([color,0,v]);
		    }

		    // graph the result and display in a window
		    var graph2 = graph(x_values,'log(Frequency in Hz)',z_values,'degrees');
		    diagram.window('AC Analysis - Phase',graph2);
		    var graph1 = graph(x_values,'log(Frequency in Hz)',y_values,'dB');
		    diagram.window('AC Analysis - Magnitude',graph1,50);
		}
	    }
	}

	// t is the time at which we want a value
	// times is a list of timepoints from the simulation
	function interpolate(t,times,values) {
	    if (values == undefined) return undefined;

	    for (var i = 0; i < times.length; i++)
		if (t < times[i]) {
		    // t falls between times[i-1] and times[i]
		    var t1 = (i == 0) ? times[0] : times[i-1];
		    var t2 = times[i];

		    if (t2 == undefined) return undefined;

		    var v1 = (i == 0) ? values[0] : values[i-1];
		    var v2 = values[i];
		    var v = v1;
		    if (t != t1) v += (t - t1)*(v2 - v1)/(t2 - t1);
		    return v;
		}
	}

	// add AC analysis to tool bar
	jade.schematic_tools.push(['AC','AC','AC Analysis',setup_ac_analysis]);

	///////////////////////////////////////////////////////////////////////////////
	//
	// Transient Analysis
	//
	//////////////////////////////////////////////////////////////////////////////

	function setup_transient_analysis(diagram) {
	    diagram.remove_annotations();

	    var tstop_lbl = 'Stop Time (seconds)';
    
	    // use modules in the analog library as the leafs
	    var mlist = [];
	    for (m in jade.libraries.analog.modules) mlist.push('analog:'+m);
	    var netlist = diagram.netlist(mlist);

	    if (find_probes(netlist).length == 0) {
		alert("Transient Analysis: there are no probes in the diagram!");
		return;
	    }

	    var module = diagram.aspect.module;
	    var fields = {};
	    fields[tstop_lbl] = jade.build_input('text',10,module.properties.tran_tstop);

	    var content = jade.build_table(fields);

	    diagram.dialog('Transient Analysis',content,function() {
		    // retrieve parameters, remember for next time
		    module.set_property('tran_tstop',fields[tstop_lbl].value);
		    var tstop = parse_number(module.properties.tran_tstop);

		    if (netlist.length > 0 && tstop != undefined) {
			var ckt = new Circuit();
			if (!ckt.load_netlist(netlist)) return;

			// gather a list of nodes that are being probed.  These
			// will be added to the list of nodes checked during the
			// LTE calculations in transient analysis
			var probes = find_probes(netlist);
			var probe_names = {};
			for (var i = probes.length - 1; i >= 0; --i)
			    probe_names[i] = probes[i][1];

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
			var stop = jade.build_button('Stop',function(event) {
				event.target.progress.stop_requested = true;
			    });
			stop.progress = progress;
			progress.appendChild(stop);

			progress.update_interval = 250;   // ms between progress bar updates
			progress.stop_requested = false;
			progress.finish = transient_results;   // what to do when done!
			progress.probes = probes;	// stash other useful info...
			progress.probe_names = probe_names;

			diagram.window('Progress',progress);   // display progress bar

			// continue after a word from our sponsor
			setTimeout(function(){ ckt.tran_start(progress,100,0,tstop); },1);
		    }
		});
	}

	// process results of transient analysis
	function transient_results(results,progress) {
	    var diagram = progress.win.diagram;
	    var probes = progress.probes;
	    var probe_names = progress.probe_names;

	    jade.window_close(progress.win);  // all done with progress bar

	    if (typeof results == 'string')
		alert("Error during Transient analysis:\n\n"+results);
	    else if (results == undefined)
		alert("Sorry, no results from transient analysis to plot!");
	    else {
		var x_values = results._time_;

		// see what we need to submit.  Expecting attribute of the form
		// submit_analyses="{'tran':[[node_name,t1,t2,t3],...],
		//                   'ac':[[node_name,f1,f2,...],...]}"
		var submit = diagram.getAttribute('submit_analyses');
		if (submit && submit.indexOf('{') == 0) submit = JSON.parse(submit).tran;
		else submit = undefined;

		if (submit != undefined) {
		    // save a copy of the results for submission
		    var tran_results = {};

		    // save requested values for each requested node
		    for (var j = 0; j < submit.length; j++) {
			var tlist = submit[j];    // [node_name,t1,t2,...]
			var node = tlist[0];
			var values = results[node];
			var tvlist = [];
			// for each requested time, interpolate waveform value
			for (var k = 1; k < tlist.length; k++) {
			    var t = tlist[k];
			    var v = interpolate(t,x_values,values);
			    tvlist.push([t,v == undefined ? 'undefined' : v]);
			}
			// save results as list of [t,value] pairs
			tran_results[node] = tvlist;
		    }

		    diagram.aspect.module.set_property('tran_result',tran_result);
		}

		// set up plot values for each node with a probe
		var v_values = [];  // voltage values: list of [color,offset,result_array]
		var i_values = [];  // current values: list of [color,offset,result_array]
		var x_legend = 'Time';
		for (var i = probes.length - 1; i >= 0; --i) {
		    var color = probes[i][0];
		    var label = probes[i][1];
		    var offset = parse_number(probes[i][2]);
		    var v = results[label];
		    if (v == undefined) {
			alert('The ' + color + ' probe is connected to node ' + '"' + label + '"' + ' which is not an actual circuit node');
		    } else if (probes[i][3] == 'voltage') {
			if (color == 'x-axis') {
			    x_values = v;
			    x_legend = 'Voltage';
			} else v_values.push([color,offset,v]);
		    } else {
			if (color == 'x-axis') {
			    x_values = v;
			    x_legend = 'Current';
			} else i_values.push([color,offset,v]);
		    }
		}
		
		// graph the result and display in a window
		var graph1 = graph(x_values,x_legend,v_values,'Voltage',i_values,'Current');
		diagram.window('Results of Transient Analysis',graph1);
	    }
	}


	// add transient analysis to tool bar
	jade.schematic_tools.push(['tran','TRAN','Transient Analysis',setup_transient_analysis]);

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Circuit analysis
	//
	//////////////////////////////////////////////////////////////////////////////

	// types of "nodes" in the linear system
	var T_VOLTAGE = 0;
	var T_CURRENT = 1;

        var v_newt_lim = 0.3;   // Voltage limited Newton great for Mos/diodes
	var v_abstol = 1e-6;	// Absolute voltage error tolerance
	var i_abstol = 1e-12;	// Absolute current error tolerance
        var eps = 1.0e-12;           // A very small number compared to one.
	var dc_max_iters = 1000;	// max iterations before giving pu
	var max_tran_iters = 20;	// max iterations before giving up
	var time_step_increase_factor = 2.0;  // How much can lte let timestep grow.
	var lte_step_decrease_factor = 8;    // Limit lte one-iter timestep shrink.
	var nr_step_decrease_factor = 4;     // Newton failure timestep shink.
	var reltol = 0.0001;		// Relative tol to max observed value
        var lterel = 10;             // LTE/Newton tolerance ratio (> 10!)
        var res_check_abs = Math.sqrt(i_abstol); // Loose Newton residue check
        var res_check_rel = Math.sqrt(reltol); // Loose Newton residue check

	function Circuit() {
	    this.node_map = {};
	    this.ntypes = [];
	    this.initial_conditions = [];  // ic's for each element

	    this.devices = [];  // list of devices
	    this.device_map = {};  // map name -> device
	    this.voltage_sources = [];  // list of voltage sources
	    this.current_sources = [];  // list of current sources

	    this.finalized = false;
	    this.diddc = false;
	    this.node_index = -1;

	    this.periods = 1
	}

	// index of ground node
	Circuit.prototype.gnd_node = function() {
	    return -1;
	}

	// allocate a new node index
	Circuit.prototype.node = function(name,ntype,ic) {
	    this.node_index += 1;
	    if (name) this.node_map[name] = this.node_index;
	    this.ntypes.push(ntype);
	    this.initial_conditions.push(ic);
	    return this.node_index;
	}

	// call to finalize the circuit in preparation for simulation
	Circuit.prototype.finalize = function() {
	    if (!this.finalized) {
		this.finalized = true;
		this.N = this.node_index + 1;  // number of nodes

		// give each device a chance to finalize itself
		for (var i = this.devices.length - 1; i >= 0; --i)
		    this.devices[i].finalize(this);

		// set up augmented matrix and various temp vectors
		this.matrix = mat_make(this.N, this.N+1);
		this.Gl = mat_make(this.N, this.N);  // Matrix for linear conductances
		this.G = mat_make(this.N, this.N);  // Complete conductance matrix
		this.C = mat_make(this.N, this.N);  // Matrix for linear L's and C's

		this.soln_max = new Array(this.N);   // max abs value seen for each unknown
		this.abstol = new Array(this.N);
		this.solution = new Array(this.N);
		this.rhs = new Array(this.N);
		for (var i = this.N - 1; i >= 0; --i) {	    
		    this.soln_max[i] = 0.0;
		    this.abstol[i] = this.ntypes[i] == T_VOLTAGE ? v_abstol : i_abstol;
		    this.solution[i] = 0.0;
		    this.rhs[i] = 0.0;
		}

		// Load up the linear elements once and for all
		for (var i = this.devices.length - 1; i >= 0; --i) {
		    this.devices[i].load_linear(this)
		}

		// Check for voltage source loops. 
		var n_vsrc = this.voltage_sources.length;
		if (n_vsrc > 0) { // At least one voltage source
		    var GV = mat_make(n_vsrc, this.N);  // Loop check
		    for (var i = n_vsrc - 1; i >= 0; --i) {
			var branch = this.voltage_sources[i].branch;
			for (var j = this.N - 1; j >= 0; j--)
			    GV[i][j] = this.Gl[branch][j];
		    }
		    var rGV = mat_rank(GV);
		    if (rGV < n_vsrc) {
			throw 'Warning!!! Circuit has a voltage source loop or a source or current probe shorted by a wire, please remove the source or the wire causing the short.';
		    }
		}
	    }
	    return true;		
	}

	// these components are extracted but don't represent a cktsim device
	var ignored_components = ["analog:g",
				  "analog:vdd",
				  "analog:port-in",
				  "analog:port-out",
				  "analog:port-inout",
				  "analog:s"
				  ];

	// load circuit from JSON netlist: [[device,[connections,...],{prop: value,...}]...]
	Circuit.prototype.load_netlist = function(netlist) {
	    // set up mapping for all ground connections
	    for (var i = netlist.length - 1; i >= 0; --i) {
		var component = netlist[i];
		if (component[0] == 'analog:g') {
		    var connections = component[1];
		    this.node_map[connections.gnd] = this.gnd_node();
		}
	    }

	    // process each component in the JSON netlist (see schematic.js for format)
	    var found_ground = false;   // is some component hooked to gnd?
	    var counts = {};
	    for (var i = netlist.length - 1; i >= 0; --i) {
		var component = netlist[i];
		var type = component[0];
		var connections = component[1];
		var properties = component[2];

		// ignore components not relevant to creating simulation devices
		if (ignored_components.indexOf(type) != -1) continue;

		counts[type] = (counts[type] || 0) + 1;

		// convert node names to circuit indicies
		for (var c in connections) {
		    var node = connections[c];
		    var index = this.node_map[node];
		    if (index == undefined) index = this.node(node,T_VOLTAGE);
		    else if (index == this.gnd_node()) found_ground = true;
		    connections[c] = index;
		}

		// process the component
		var name = properties.name;
		if (type == 'analog:r')	// resistor
		    this.r(connections.n1,connections.n2,properties.r,name);
		else if (type == 'analog:d')	// diode
		    this.d(connections.anode,connections.cathode,properties.area,properties.type,name);
		else if (type == 'analog:c')   // capacitor
		    this.c(connections.n1,connections.n2,properties.c,name);
		else if (type == 'analog:l')	// inductor
		    this.l(connections.n1,connections.n2,properties.l,name);
		else if (type == 'analog:v') 	// voltage source
		    this.v(connections.nplus,connections.nminus,properties.value,name);
		else if (type == 'analog:i') 	// current source
		    this.i(connections.nplus,connections.nminus,properties.value,name);
		else if (type == 'analog:o') 	// op amp
		    this.opamp(connections.nplus,connections.nminus,connections.output,connections.gnd,properties.A,name);
		else if (type == 'analog:nfet') 	// n fet
		    this.n(connections.D,connections.G,connections.S,properties.W,properties.L,name);
		else if (type == 'analog:pfet') 	// p fet
		    this.p(connections.D,connections.G,connections.S,properties.W,properties.L,name);
		else if (type == 'analog:a') 	// current probe == 0-volt voltage source
		    this.v(connections.nplus,connections.nminus,'0',name);
	    }

	    if (!found_ground) { // No ground connection from some device
		alert('Please make at least one connection to ground  (inverted triangle symbol)');
		return false;
	    }

	    var msg = (this.node_index + 1).toString() + ' nodes';
	    for (d in counts) msg += ', '+counts[d].toString()+' '+d.split(':')[1];
	    console.log(msg);

	    return true;
	}

	// if converges: updates this.solution, this.soln_max, returns iter count
	// otherwise: return undefined and set this.problem_node
	// Load should compute -f and df/dx (note the sign pattern!)
        Circuit.prototype.find_solution = function(load,maxiters) {
	    var soln = this.solution;
	    var rhs = this.rhs;
	    var d_sol = new Array();
	    var abssum_compare;
	    var converged,abssum_old=0, abssum_rhs;
	    var use_limiting = false;
	    var down_count = 0;

	    // iteratively solve until values converge or iteration limit exceeded
	    for (var iter = 0; iter < maxiters; iter++) {
		// set up equations
		load.call(this,soln,rhs);   // load should be a method of Circuit

		// Compute norm of rhs, assume variables of v type go with eqns of i type
		abssum_rhs = 0;
		for (var i = this.N - 1; i >= 0; --i)
		    if (this.ntypes[i] == T_VOLTAGE)
			abssum_rhs += Math.abs(rhs[i]);

		if ((iter > 0) && (use_limiting == false) && (abssum_old < abssum_rhs)) {  
		    // Old rhsnorm was better, undo last iter and turn on limiting
		    for (var i = this.N - 1; i >= 0; --i)
			soln[i] -= d_sol[i];
		    iter -= 1;
		    use_limiting = true;
		}
	        else {  // Compute the Newton delta
		    //d_sol = mat_solve(this.matrix,rhs);
		    d_sol = mat_solve_rq(this.matrix,rhs);

		    // If norm going down for ten iters, stop limiting
		    if (abssum_rhs < abssum_old)
			down_count += 1;
		    else 
			down_count = 0;
		    if (down_count > 10) {
			use_limiting = false;
			down_count = 0;
		    }

		    // Update norm of rhs
		    abssum_old = abssum_rhs;		    
		}

		// Update the worst case abssum for comparison.
		if ((iter == 0) || (abssum_rhs > abssum_compare))
		    abssum_compare = abssum_rhs;

		// Check residue convergence, but loosely, and give up 
		// on last iteration
		if ( (iter < (maxiters - 1)) &&
		     (abssum_rhs > (res_check_abs+res_check_rel*abssum_compare)))
		    converged = false;
		else converged = true;


		// Update solution and check delta convergence
		for (var i = this.N - 1; i >= 0; --i) {
		    // Simple voltage step limiting to encourage Newton convergence
		    if (use_limiting) {
			if (this.ntypes[i] == T_VOLTAGE) {
			    d_sol[i] = (d_sol[i] > v_newt_lim) ? v_newt_lim : d_sol[i];
			    d_sol[i] = (d_sol[i] < -v_newt_lim) ? -v_newt_lim : d_sol[i];
			}
		    }
		    soln[i] += d_sol[i];
		    thresh = this.abstol[i] + reltol*this.soln_max[i];
		    if (Math.abs(d_sol[i]) > thresh) {
			converged = false;
			this.problem_node = i;
		    }
		}

		//alert(numeric.prettyPrint(this.solution);)
                if (converged == true) {
		    for (var i = this.N - 1; i >= 0; --i) 
			if (Math.abs(soln[i]) > this.soln_max[i])
			    this.soln_max[i] = Math.abs(soln[i]);
		    
		    return iter+1;
		}
	    }
	    return undefined;
	}

	// Define -f and df/dx for Newton solver
	Circuit.prototype.load_dc = function(soln,rhs) {
	    // rhs is initialized to -Gl * soln
	    mat_v_mult(this.Gl, soln, rhs, -1.0);
	    // G matrix is initialized with linear Gl
	    mat_copy(this.Gl,this.G);
	    // Now load up the nonlinear parts of rhs and G
	    for (var i = this.devices.length - 1; i >= 0; --i)
		this.devices[i].load_dc(this,soln,rhs);
	    // G matrix is copied in to the system matrix
	    mat_copy(this.G,this.matrix);
	}

	// DC analysis
	Circuit.prototype.dc = function() {

	    // Allocation matrices for linear part, etc.
	    if (this.finalize() == false)
		return undefined;

	    // find the operating point
	    var iterations = this.find_solution(Circuit.prototype.load_dc,dc_max_iters);

	    if (typeof iterations == 'undefined') {
		// too many iterations
		if (this.current_sources.length > 0) {
		    throw 'Newton Method Failed, do your current sources have a conductive path to ground?';
		} else {
		    throw 'Newton Method Failed, it may be your circuit or it may be our simulator.';
		}

		return undefined;
	    } else {
		// Note that a dc solution was computed
		this.diddc = true;
		// create solution dictionary
		var result = {};
		// capture node voltages
		for (var name in this.node_map) {
		    var index = this.node_map[name];
		    result[name] = (index == -1) ? 0 : this.solution[index];
		}
		// capture branch currents from voltage sources
		for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
		    var v = this.voltage_sources[i];
		    result['I('+v.name+')'] = this.solution[v.branch];
		}
		return result;
	    }
	}

	// initialize everything for transient analysis
	Circuit.prototype.tran_start = function(progress,ntpts,tstart,tstop) {
	    try {
		// Standard to do a dc analysis before transient
		// Otherwise, do the setup also done in dc.
		var no_dc = false;
		if ((this.diddc == false) && (no_dc == false)) {
		    if (this.dc() == undefined) { // DC failed, realloc mats and vects.
			alert('DC failed, trying transient analysis from zero.');		    
			this.finalized = false;  // Reset the finalization.
			if (this.finalize() == false) 
			    progress.finish(undefined,progress);  // nothing more to do

		    }
		}
		else if (this.finalize() == false) // Allocate matrices and vectors.
		    progress.finish(undefined,progress);  // nothing more to do

		// build array to hold list of results for each variable
		// last entry is for timepoints.
		this.response = new Array(this.N + 1);
		for (var i = this.N; i >= 0; --i) this.response[i] = new Array();

		// Allocate back vectors for up to a second order method
		this.old3sol = new Array(this.N);
		this.old3q = new Array(this.N);
		this.old2sol = new Array(this.N);
		this.old2q = new Array(this.N);
		this.oldsol = new Array(this.N);
		this.oldq = new Array(this.N);
		this.q = new Array(this.N);
		this.oldc = new Array(this.N);
		this.c = new Array(this.N);
		this.alpha0 = 1.0;
		this.alpha1 = 0.0;
		this.alpha2 = 0.0;
		this.beta0 = new Array(this.N);
		this.beta1 = new Array(this.N);

		// Mark a set of algebraic variable (don't miss hidden ones!).
		this.ar = this.algebraic(this.C);

		// Non-algebraic variables and probe variables get lte
		this.ltecheck = new Array(this.N);
		for (var i = this.N; i >= 0; --i) 
		    this.ltecheck[i] = (this.ar[i] == 0);

		for (var name in this.node_map) {
		    var index = this.node_map[name];
		    for (var i = progress.probe_names.length; i >= 0; --i) {
			if (name == progress.probe_names[i]) {
			    this.ltecheck[index] = true;
			    break;
			}
		    }
		}

		// Check for periodic sources
		var period = tstop - tstart;
		for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
		    var per = this.voltage_sources[i].src.period;
		    if (per > 0)
			period = Math.min(period, per);
		}
		for (var i = this.current_sources.length - 1; i >= 0; --i) {
		    var per = this.current_sources[i].src.period;
		    if (per > 0)
			period = Math.min(period, per);
		}
		this.periods = Math.ceil((tstop - tstart)/period);
		// maximum 50000 steps/period
		this.max_nsteps = this.periods*50000;

		this.time = tstart;
		// ntpts adjusted by numbers of periods in input
		this.max_step = (tstop - tstart)/(this.periods*ntpts);
		this.min_step = this.max_step/1e8;
		this.new_step = this.max_step/1e6;
		this.oldt = this.time - this.new_step;

		// Initialize old crnts, charges, and solutions.
		this.load_tran(this.solution,this.rhs)
		for (var i = this.N-1; i >= 0; --i) {
		    this.old3sol[i] = this.solution[i];
		    this.old2sol[i] = this.solution[i];
		    this.oldsol[i] = this.solution[i];
		    this.old3q[i] = this.q[i]; 
		    this.old2q[i] = this.q[i]; 
		    this.oldq[i] = this.q[i]; 
		    this.oldc[i] = this.c[i]; 
		}
	    
		// now for the real work
		this.tstart = tstart;
		this.tstop = tstop;
		this.progress = progress;
		this.step_index = -3;  // Start with two pseudo-Euler steps
		this.tran_steps(new Date().getTime() + progress.update_interval);
	    }
	    catch (e) {
		if (typeof e == 'string')
		    progress.finish(e,progress);
		else throw e;
	    }
	}

	Circuit.prototype.pick_step = function() {
	    var min_shrink_factor = 1.0/lte_step_decrease_factor;
	    var max_growth_factor = time_step_increase_factor;

	    // Poly coefficients
	    var dtt0 = (this.time - this.oldt);
	    var dtt1 = (this.time - this.old2t);
	    var dtt2 = (this.time - this.old3t);
	    var dt0dt1 = (this.oldt - this.old2t);
	    var dt0dt2 = (this.oldt - this.old3t);
	    var dt1dt2 = (this.old2t - this.old3t);
	    var p0 = (dtt1*dtt2)/(dt0dt1 * dt0dt2);
	    var p1 = (dtt0*dtt2)/(-dt0dt1 * dt1dt2);
	    var p2 = (dtt0*dtt1)/(dt0dt2 * dt1dt2);

	    var trapcoeff = 0.5*(this.time - this.oldt)/(this.time - this.old3t);
	    var maxlteratio = 0.0;
	    for (var i = this.N-1; i >= 0; --i) {
		if (this.ltecheck[i]) { // Check lte on variable
		    var pred = p0*this.oldsol[i] + p1*this.old2sol[i] + p2*this.old3sol[i];
		    var lte = Math.abs((this.solution[i] - pred))*trapcoeff;
		    var lteratio = lte/(lterel*(this.abstol[i] + reltol*this.soln_max[i]));
		    maxlteratio = Math.max(maxlteratio, lteratio);
		}
	    }
	    var new_step;
	    var lte_step_ratio = 1.0/Math.pow(maxlteratio,1/3); // Cube root because trap
	    if (lte_step_ratio < 1.0) { // Shrink the timestep to make lte
		lte_step_ratio = Math.max(lte_step_ratio,min_shrink_factor);
		new_step = (this.time - this.oldt)*0.75*lte_step_ratio;
		new_step = Math.max(new_step, this.min_step);
	    } else {
		lte_step_ratio = Math.min(lte_step_ratio, max_growth_factor);
		if (lte_step_ratio > 1.2)  /* Increase timestep due to lte. */
		    new_step = (this.time - this.oldt) * lte_step_ratio / 1.2;
		else 
		    new_step = (this.time - this.oldt);
		new_step = Math.min(new_step, this.max_step);
	    }
	    return new_step;
	}

	// Define -f and df/dx for Newton solver
	Circuit.prototype.load_tran = function(soln,rhs) {
	    // Crnt is initialized to -Gl * soln
	    mat_v_mult(this.Gl, soln, this.c,-1.0);
	    // G matrix is initialized with linear Gl
	    mat_copy(this.Gl,this.G);
	    // Now load up the nonlinear parts of crnt and G
	    for (var i = this.devices.length - 1; i >= 0; --i)
		this.devices[i].load_tran(this,soln,this.c,this.time);
	    // Exploit the fact that storage elements are linear
	    mat_v_mult(this.C, soln, this.q, 1.0);
	    // -rhs = c - dqdt
	    for (var i = this.N-1; i >= 0; --i) {
		var dqdt = this.alpha0*this.q[i] + this.alpha1*this.oldq[i] + 
		    this.alpha2*this.old2q[i];
		//alert(numeric.prettyPrint(dqdt));
		rhs[i] = this.beta0[i]*this.c[i] + this.beta1[i]*this.oldc[i] - dqdt;
	    }
	    // matrix = beta0*G + alpha0*C.
	    mat_scale_add(this.G,this.C,this.beta0,this.alpha0,this.matrix);
	}

	// here's where the real work is done
	// tupdate is the time we should update progress bar
        Circuit.prototype.tran_steps = function(tupdate) {
	    if (!this.progress.stop_requested)   // halt when user clicks stop
		while (this.step_index < this.max_nsteps) {
		    // Save the just computed solution, and move back q and c.
		    for (var i = this.N - 1; i >= 0; --i) {
			if (this.step_index >= 0)
			    this.response[i].push(this.solution[i]);
			this.oldc[i] = this.c[i];
			this.old3sol[i] = this.old2sol[i];
			this.old2sol[i] = this.oldsol[i];
			this.oldsol[i] = this.solution[i];
			this.old3q[i] = this.oldq[i];
			this.old2q[i] = this.oldq[i];
			this.oldq[i] = this.q[i];

		    }

		    if (this.step_index < 0) {  // Take a prestep using BE
			this.old3t = this.old2t - (this.oldt-this.old2t)
			this.old2t = this.oldt - (this.tstart-this.oldt)
			this.oldt = this.tstart - (this.time - this.oldt);
			this.time = this.tstart;
			this._beta0 = 1.0;  
			this._beta1 = 0.0;		
		    } else {  // Take a regular step
			// Save the time, and rotate time wheel
			this.response[this.N].push(this.time);
			this.old3t = this.old2t;
			this.old2t = this.oldt;
			this.oldt = this.time;
			// Make sure we come smoothly in to the interval end.
			if (this.time >= this.tstop) break; // We're done!
			else if(this.time + this.new_step > this.tstop)
			    this.time = this.tstop;
			else if(this.time + 1.5*this.new_step > this.tstop)
			    this.time += (2/3)*(this.tstop - this.time);
			else
			    this.time += this.new_step;

			// Use trap (average old and new crnts.
			this._beta0 = 0.5;
			this._beta1 = 0.5;	
		    }

		    // For trap rule, turn off current avging for algebraic eqns
		    for (var i = this.N - 1; i >= 0; --i) {
			this.beta0[i] = this._beta0 + this.ar[i]*this._beta1;
			this.beta1[i] = (1.0 - this.ar[i])*this._beta1;
		    }

		    // Loop to find NR converging timestep with okay LTE
		    while (true) {
			// Set the timestep coefficients (alpha2 is for bdf2).
			this.alpha0 = 1.0/(this.time - this.oldt);
			this.alpha1 = -this.alpha0;
			this.alpha2 = 0;

			// If timestep is 1/10,000th of tstop, just use BE.
			if ((this.time-this.oldt) < 1.0e-4*this.tstop) {
			    for (var i = this.N - 1; i >= 0; --i) {
				this.beta0[i] = 1.0;
				this.beta1[i] = 0.0;
			    }
			}  
			// Use Newton to compute the solution.
			var iterations = this.find_solution(Circuit.prototype.load_tran,max_tran_iters);

			// If NR succeeds and stepsize is at min, accept and newstep=maxgrowth*minstep.
			// Else if Newton Fails, shrink step by a factor and try again
			// Else LTE picks new step, if bigger accept current step and go on.
			if ((iterations != undefined) && 
			    (this.step_index <= 0 || (this.time-this.oldt) < (1+reltol)*this.min_step)) {
			    if (this.step_index > 0) this.new_step = time_step_increase_factor*this.min_step;
			    break;
			} else if (iterations == undefined) {  // NR nonconvergence, shrink by factor
			    //alert('timestep nonconvergence ' + this.time + ' ' + this.step_index);
			    this.time = this.oldt + 
			    (this.time - this.oldt)/nr_step_decrease_factor;
			} else {  // Check the LTE and shrink step if needed.
			    this.new_step = this.pick_step();
			    if (this.new_step < (1.0 - reltol)*(this.time - this.oldt)) {
				this.time = this.oldt + this.new_step;  // Try again   
			    }
			    else
				break;  // LTE okay, new_step for next step
			}
		    }
		
		    this.step_index += 1;

		    var t = new Date().getTime();
		    if (t >= tupdate) {
			// update progress bar
			var completed = Math.round(100*(this.time - this.tstart)/(this.tstop - this.tstart));
			$(this.progress.bar).width(completed.toString()+'%');

			// a brief break in the action to allow progress bar to update
			// then pick up where we left off
			var ckt = this;
			setTimeout(function() {
				try {
				    ckt.tran_steps(t+ckt.progress.update_interval);
				}
				catch (e) {
				    if (typeof e == 'string')
					ckt.progress.finish(e,ckt.progress);
				    else throw e;
				}
			    },1);

			// our portion of the work is done
			return;
		    }
		}

	    // analysis complete -- create solution dictionary
	    var result = new Array();
	    for (var name in this.node_map) {
		var index = this.node_map[name];
		result[name] = (index == -1) ? 0 : this.response[index];
	    }
	    // capture branch currents from voltage sources
	    for (var i = this.voltage_sources.length - 1; i >= 0; --i) {
		var v = this.voltage_sources[i];
		result['I('+v.name+')'] = this.response[v.branch];
	    }
	    result._time_ = this.response[this.N];

	    this.progress.finish(result,this.progress);
	}

	// AC analysis: npts/decade for freqs in range [fstart,fstop]
	// result._frequencies_ = vector of log10(sample freqs)
	// result['xxx'] = vector of dB(response for node xxx)
        // NOTE: Normalization removed in schematic.js, jkw.
        Circuit.prototype.ac = function(npts,fstart,fstop,source_name) {

	    if (this.dc() == undefined) { // DC failed, realloc mats and vects.
		return undefined;
	    }

	    var N = this.N;
	    var G = this.G;
	    var C = this.C;

	    // Complex numbers, we're going to need a bigger boat
	    var matrixac = mat_make(2*N, (2*N)+1);

            // Get the source used for ac
	    if (this.device_map[source_name] === undefined) {
		throw 'AC analysis refers to unknown source ' + source_name;
	    }
	    this.device_map[source_name].load_ac(this,this.rhs);

	    // build array to hold list of magnitude and phases for each node
	    // last entry is for frequency values
	    var response = new Array(2*N + 1);
	    for (var i = 2*N; i >= 0; --i) response[i] = new Array();

	    // multiplicative frequency increase between freq points
	    var delta_f = Math.exp(Math.LN10/npts);

	    var phase_offset = new Array(N);
	    for (var i = N-1; i >= 0; --i) phase_offset[i] = 0;

	    var f = fstart;
	    fstop *= 1.0001;  // capture that last freq point!
	    while (f <= fstop) {
		var omega = 2 * Math.PI * f;
		response[2*N].push(f);   // 2*N for magnitude and phase

		// Find complex x+jy that sats Gx-omega*Cy=rhs; omega*Cx+Gy=0
		// Note: solac[0:N-1]=x, solac[N:2N-1]=y
		for (var i = N-1; i >= 0; --i) {
		    // First the rhs, replicated for real and imaginary
		    matrixac[i][2*N] = this.rhs[i];
		    matrixac[i+N][2*N] = 0;

		    for (var j = N-1; j >= 0; --j) {
			matrixac[i][j] = G[i][j];
			matrixac[i+N][j+N] = G[i][j];
			matrixac[i][j+N] = -omega*C[i][j];
			matrixac[i+N][j] = omega*C[i][j];
		    }
		}

		// Compute the small signal response
		var solac = mat_solve(matrixac);

		// Save magnitude and phase
		for (var i = N - 1; i >= 0; --i) {
		    var mag = Math.sqrt(solac[i]*solac[i] + solac[i+N]*solac[i+N]);
		    response[i].push(mag);

		    // Avoid wrapping phase, add or sub 180 for each jump
		    var phase = 180*(Math.atan2(solac[i+N],solac[i])/Math.PI);
		    var phasei = response[i+N];
		    var L = phasei.length;
		    // Look for a one-step jump greater than 90 degrees
		    if (L > 1) {
			var phase_jump = phase + phase_offset[i] - phasei[L-1];
			if (phase_jump > 90) {
			    phase_offset[i] -= 360;
			} else if (phase_jump < -90) {
			    phase_offset[i] += 360;
			}
		    }
		    response[i+N].push(phase + phase_offset[i]);
		}
		f *= delta_f;    // increment frequency
	    }

	    // create solution dictionary
	    var result = {};
	    for (var name in this.node_map) {
		var index = this.node_map[name];
		result[name] = (index == -1) ? 0 : response[index];
		result[name+'_phase'] = (index == -1) ? 0 : response[index+N];
	    }
	    result._frequencies_ = response[2*N];
	    return result;
	}


        // Helper for adding devices to a circuit, warns on duplicate device names.
        Circuit.prototype.add_device = function(d,name) {
	    // Add device to list of devices and to device map
	    this.devices.push(d);
	    d.name = name;
	    if (name) this.device_map[name] = d;
	    return d;
	}

	Circuit.prototype.r = function(n1,n2,v,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof v) == 'string') {
		v = parse_number_alert(v);
		if (v === undefined) return undefined;
	    }

	    if (v != 0) {
		var d = new Resistor(n1,n2,v);
		return this.add_device(d, name);
	    } else return this.v(n1,n2,'0',name);   // zero resistance == 0V voltage source
	}

	Circuit.prototype.d = function(n1,n2,area,type,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof area) == 'string') {
		area = parse_number_alert(area);
		if (area === undefined) return undefined;
	    }

	    if (area != 0) {
		var d = new Diode(n1,n2,area,type);
		return this.add_device(d, name);
	    } // zero area diodes discarded.
	}


	Circuit.prototype.c = function(n1,n2,v,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof v) == 'string') {
		v = parse_number_alert(v);
		if (v === undefined) return undefined;
	    }
	    var d = new Capacitor(n1,n2,v);
	    return this.add_device(d, name);
	}

	Circuit.prototype.l = function(n1,n2,v,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof v) == 'string') {
		v = parse_number_alert(v);
		if (v === undefined) return undefined;
	    }
	    var branch = this.node(undefined,T_CURRENT);
	    var d = new Inductor(n1,n2,branch,v);
	    return this.add_device(d, name);
	}

        Circuit.prototype.v = function(n1,n2,v,name) {
	    var branch = this.node(undefined,T_CURRENT);
	    var d = new VSource(n1,n2,branch,v);
	    this.voltage_sources.push(d);
	    return this.add_device(d, name);
	}

	Circuit.prototype.i = function(n1,n2,v,name) {
	    var d = new ISource(n1,n2,v);
	    this.current_sources.push(d);
	    return this.add_device(d, name);
	}

        Circuit.prototype.opamp = function(np,nn,no,ng,A,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof A) == 'string') {
		ratio = parse_number_alert(A);
		if (A === undefined) return undefined;
	    }
	    var branch = this.node(undefined,T_CURRENT);
	    var d = new Opamp(np,nn,no,ng,branch,A,name);
	    return this.add_device(d, name);
	}

        Circuit.prototype.n = function(d,g,s,W,L,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof W) == 'string') {
		W = parse_number_alert(W);
		if (W === undefined) return undefined;
	    }
	    if ((typeof L) == 'string') {
		L = parse_number_alert(L);
		if (L === undefined) return undefined;
	    }
	    var d = new Fet(d,g,s,W,L,name,'n');
	    return this.add_device(d, name);
	}

        Circuit.prototype.p = function(d,g,s,W,L,name) {
	    // try to convert string value into numeric value, barf if we can't
	    if ((typeof W) == 'string') {
		W = parse_number_alert(W);
		if (W === undefined) return undefined;
	    }
	    if ((typeof L) == 'string') {
		L = parse_number_alert(L);
		if (L === undefined) return undefined;
	    }
	    var d = new Fet(d,g,s,W,L,name,'p');
	    return this.add_device(d, name);
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Support for creating conductance and capacitance matrices associated with
        //  modified nodal analysis (unknowns are node voltages and inductor and voltage
        //  source currents). 
        //  The linearized circuit is written as 
        //          C d/dt x = G x + rhs
        //  x - vector of node voltages and element currents
        //  rhs - vector of source values
        //  C - Matrix whose values are capacitances and inductances, has many zero rows.
        //  G - Matrix whose values are conductances and +-1's.
	//
	////////////////////////////////////////////////////////////////////////////////

	// add val component between two nodes to matrix M
	// Index of -1 refers to ground node
        Circuit.prototype.add_two_terminal = function(i,j,g,M) {
	    if (i >= 0) {
		M[i][i] += g;
		if (j >= 0) {
		    M[i][j] -= g;
		    M[j][i] -= g;
		    M[j][j] += g;
		}
	    } else if (j >= 0)
		M[j][j] += g;
	}

	// add val component between two nodes to matrix M
	// Index of -1 refers to ground node
        Circuit.prototype.get_two_terminal = function(i,j,x) {
	    var xi_minus_xj = 0;
	    if (i >= 0) xi_minus_xj = x[i];
	    if (j >= 0) xi_minus_xj -= x[j];
	    return xi_minus_xj
	}

        Circuit.prototype.add_conductance_l = function(i,j,g) {
            this.add_two_terminal(i,j,g, this.Gl)
	}

        Circuit.prototype.add_conductance = function(i,j,g) {
            this.add_two_terminal(i,j,g, this.G)
	}

        Circuit.prototype.add_capacitance = function(i,j,c) {
            this.add_two_terminal(i,j,c,this.C)
	}

	// add individual conductance to Gl matrix
	Circuit.prototype.add_to_Gl = function(i,j,g) {
	    if (i >=0 && j >= 0)
		this.Gl[i][j] += g;
	}

	// add individual conductance to Gl matrix
	Circuit.prototype.add_to_G = function(i,j,g) {
	    if (i >=0 && j >= 0)
		this.G[i][j] += g;
	}

	// add individual capacitance to C matrix
	Circuit.prototype.add_to_C = function(i,j,c) {
	    if (i >=0 && j >= 0)
		this.C[i][j] += c;
	}

	// add source info to rhs
        Circuit.prototype.add_to_rhs = function(i,v,rhs) {
	    if (i >= 0)	rhs[i] += v;
	}


	///////////////////////////////////////////////////////////////////////////////
	//
	//  Generic matrix support - making, copying, factoring, rank, etc
	//  Note, Matrices are stored using nested javascript arrays.
	////////////////////////////////////////////////////////////////////////////////

        // Allocate an NxM matrix
        function mat_make(N,M) {
	    var mat = new Array(N);	
	    for (var i = N - 1; i >= 0; --i) {	    
		mat[i] = new Array(M);
		for (var j = M - 1; j >= 0; --j) {	    
		    mat[i][j] = 0.0;
		}
	    }
	    return mat;
	}

        // Form b = scale*Mx
        function mat_v_mult(M,x,b,scale) {
	    var n = M.length;
	    var m = M[0].length;
	    
	    if (n != b.length || m != x.length)
		throw 'Rows of M mismatched to b or cols mismatch to x.';

	    for (var i = 0; i < n; i++) {
		var temp = 0;
		for (var j = 0; j < m; j++) temp += M[i][j]*x[j];
		b[i] = scale*temp;  // Recall the neg in the name
	    }
	}

        // C = scalea*A + scaleb*B, scalea, scaleb eithers numbers or arrays (row scaling)
        function mat_scale_add(A, B, scalea, scaleb, C) {
	    var n = A.length;
	    var m = A[0].length;
	    
	    if (n > B.length || m > B[0].length)
		throw 'Row or columns of A to large for B';
	    if (n > C.length || m > C[0].length)
		throw 'Row or columns of A to large for C';
	    if ((typeof scalea == 'number') && (typeof scaleb == 'number'))
		for (var i = 0; i < n; i++)
		    for (var j = 0; j < m; j++)
			C[i][j] = scalea*A[i][j] + scaleb*B[i][j];
	    else if ((typeof scaleb == 'number') && (scalea instanceof Array))
		for (var i = 0; i < n; i++)
		    for (var j = 0; j < m; j++)
			C[i][j] = scalea[i]*A[i][j] + scaleb*B[i][j];
	    else if ((typeof scaleb instanceof Array) && (scalea instanceof Array))
		for (var i = 0; i < n; i++)
		    for (var j = 0; j < m; j++)
			C[i][j] = scalea[i]*A[i][j] + scaleb[i]*B[i][j];
	    else
		throw 'scalea and scaleb must be scalars or Arrays';
	}

        // Returns a vector of ones and zeros, ones denote algebraic
        // variables (rows that can be removed without changing rank(M).
        Circuit.prototype.algebraic = function(M) {
	    var Nr = M.length;
	    var Mc = mat_make(Nr, Nr);
	    mat_copy(M,Mc);
	    var R = mat_rank(Mc);

	    var one_if_alg = new Array(Nr);
	    for (var row = 0; row < Nr; row++) {  // psuedo gnd row small
		for (var col = Nr - 1; col >= 0; --col)
		    Mc[row][col] = 0;
		if (mat_rank(Mc) == R)  // Zeroing row left rank unchanged
		    one_if_alg[row] = 1;
		else { // Zeroing row changed rank, put back
		    for (var col = Nr - 1; col >= 0; --col)
			Mc[row][col] = M[row][col];
		    one_if_alg[row] = 0;
		}
	    }
	    return one_if_alg;
	}

        // Copy A -> using the bounds of A
	function mat_copy(src,dest) {
	    var n = src.length;
	    var m = src[0].length;
	    if (n > dest.length || m >  dest[0].length)
		throw 'Rows or cols > rows or cols of dest';

	    for (var i = 0; i < n; i++)
		for (var j = 0; j < m; j++)
		    dest[i][j] = src[i][j];
	}
	    
        // Copy and transpose A -> using the bounds of A
	function mat_copy_transposed(src,dest) {
	    var n = src.length;
	    var m = src[0].length;
	    if (n > dest[0].length || m >  dest.length)
		throw 'Rows or cols > cols or rows of dest';

	    for (var i = 0; i < n; i++)
		for (var j = 0; j < m; j++)
		    dest[j][i] = src[i][j];
	}


	// Uses GE to determine rank.
        function mat_rank(Mo) {
	    var Nr = Mo.length;  // Number of rows
	    var Nc = Mo[0].length;  // Number of columns
	    var temp,i,j;
	    // Make a copy to avoid overwriting
	    var M = mat_make(Nr, Nc);
	    mat_copy(Mo,M);

	    // Find matrix maximum entry
	    var max_abs_entry = 0;
	    for(var row = Nr-1; row >= 0; --row) {
		for(var col = Nr-1; col >= 0; --col) {
		    if (Math.abs(M[row][col]) > max_abs_entry)
			max_abs_entry = Math.abs(M[row][col]);
		}
	    }

	    // Gaussian elimination to find rank
	    var the_rank = 0;
	    var start_col = 0;
	    for (var row = 0; row < Nr; row++) {
		// Search for first nonzero column in the remaining rows.
		for (var col = start_col; col < Nc; col++) {
		    var max_v = Math.abs(M[row][col]);
		    var max_row = row;
		    for (var i = row + 1; i < Nr; i++) {
			temp = Math.abs(M[i][col]);
			if (temp > max_v) { max_v = temp; max_row = i; }
		    }
		    // if max_v non_zero, column is nonzero, eliminate in subsequent rows
		    if (Math.abs(max_v) > eps*max_abs_entry) {
			start_col = col+1;
			the_rank += 1;
		        // Swap rows to get max in M[row][col]
			temp = M[row];
			M[row] = M[max_row];
			M[max_row] = temp;

			// now eliminate this column for all subsequent rows
			for (var i = row + 1; i < Nr; i++) {
			    temp = M[i][col]/M[row][col];   // multiplier for current row
			    if (temp != 0)  // subtract 
			    for (var j = col; j < Nc; j++) M[i][j] -= M[row][j]*temp;
			}
			// Now move on to the next row
			break;
		    }
		}
	    }

	    // return the rank
	    return the_rank;
	}

	// Solve Mx=b and return vector x using R^TQ^T factorization. 
        // Multiplication by R^T implicit, should be null-space free soln.
        // M should have the extra column!
        // Almost everything is in-lined for speed, sigh.
        function mat_solve_rq(M, rhs) {

	    var Nr = M.length;  // Number of rows
	    var Nc = M[0].length;  // Number of columns

	    // Copy the rhs in to the last column of M if one is given.
	    if (rhs != null) {
		for (var row = Nr - 1; row >= 0; --row)
		    M[row][Nc-1] = rhs[row];
	    }

	    var mat_scale = 0; // Sets the scale for comparison to zero.
	    var max_nonzero_row = Nr-1;  // Assumes M nonsingular.
	    for (var row = 0; row < Nr; row++) {  
		// Find largest row with largest 2-norm
		var max_row = row;
		var maxsumsq = 0;
		for (var rowp = row; rowp < Nr; rowp++) {
		    var Mr = M[rowp];
		    var sumsq = 0;
		    for (var col = Nc-2; col >= 0; --col)  // Last col=rhs
			sumsq += Mr[col]*Mr[col];
		    if ((row == rowp) || (sumsq > maxsumsq)) {
			max_row = rowp;
			maxsumsq = sumsq;
		    }
		}
		if (max_row > row) { // Swap rows if not max row
		    var temp = M[row];
		    M[row] = M[max_row];
		    M[max_row] = temp;
		}

		// Calculate row norm, save if this is first (largest)
		var row_norm = Math.sqrt(maxsumsq);
		if (row == 0) mat_scale = row_norm;

		// Check for all zero rows
		if (row_norm > mat_scale*eps)
		    scale = 1.0/row_norm;
		else {
		    max_nonzero_row = row - 1;  // Rest will be nullspace of M
		    break;
		}


		// Nonzero row, eliminate from rows below
		var Mr = M[row];
		for (var col =  Nc-1; col >= 0; --col) // Scale rhs also
		    Mr[col] *= scale;
		for (var rowp = row + 1; rowp < Nr; rowp++) { // Update.
		    var Mrp = M[rowp];
		    var inner = 0;
		    for (var col =  Nc-2; col >= 0; --col)  // Project 
			inner += Mr[col]*Mrp[col];
		    for (var col =  Nc-1; col >= 0; --col) // Ortho (rhs also)
			Mrp[col] -= inner *Mr[col];
		}
	    }

	    // Last Column of M has inv(R^T)*rhs.  Scale rows of Q to get x.
	    var x = new Array(Nc-1);
	    for (var col = Nc-2; col >= 0; --col)
		x[col] = 0;
	    for (var row = max_nonzero_row; row >= 0; --row) {
		Mr = M[row];
		for (var col = Nc-2; col >= 0; --col) {
		    x[col] += Mr[col]*Mr[Nc-1];
		}
	    }

	    // Return solution.
	    return x;
	}

	// solve Mx=b and return vector x given augmented matrix M = [A | b]
	// Uses Gaussian elimination with partial pivoting
        function mat_solve(M,rhs) {
	    var N = M.length;      // augmented matrix M has N rows, N+1 columns
	    var temp,i,j;

	    // Copy the rhs in to the last column of M if one is given.
	    if (rhs != null) {
		for (var row = 0; row < N ; row++)
		    M[row][N] = rhs[row];
	    }

	    // gaussian elimination
	    for (var col = 0; col < N ; col++) {
		// find pivot: largest abs(v) in this column of remaining rows
		var max_v = Math.abs(M[col][col]);
		var max_col = col;
		for (i = col + 1; i < N; i++) {
		    temp = Math.abs(M[i][col]);
		    if (temp > max_v) { max_v = temp; max_col = i; }
		}

		// if no value found, generate a small conductance to gnd
		// otherwise swap current row with pivot row
		if (max_v == 0) M[col][col] = eps; 
		else {
		    temp = M[col];
		    M[col] = M[max_col];
		    M[max_col] = temp;
		}

		// now eliminate this column for all subsequent rows
		for (i = col + 1; i < N; i++) {
		    temp = M[i][col]/M[col][col];   // multiplier we'll use for current row
		    if (temp != 0)
			// subtract current row from row we're working on
			// remember to process b too!
			for (j = col; j <= N; j++) M[i][j] -= M[col][j]*temp;
		}
	    }

	    // matrix is now upper triangular, so solve for elements of x starting
	    // with the last row
	    var x = new Array(N);
	    for (i = N-1; i >= 0; --i) {
		temp = M[i][N];   // grab b[i] from augmented matrix as RHS
		// subtract LHS term from RHS using known x values
		for (j = N-1; j > i; --j) temp -= M[i][j]*x[j];
		// now compute new x value
		x[i] = temp/M[i][i];
	    }

	    // return solution
	    return x;
	}

	// test solution code, expect x = [2,3,-1]
	//M = [[2,1,-1,8],[-3,-1,2,-11],[-2,1,2,-3]];
	//x = mat_solve(M);
	//y = 1;  // so we have place to set a breakpoint :)

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Device base class
	//
	////////////////////////////////////////////////////////////////////////////////

	function Device() {
	}

	// complete initial set up of device
	Device.prototype.finalize = function() {
	}

        // Load the linear elements in to Gl and C
        Device.prototype.load_linear = function(ckt) {
	}

	// load linear system equations for dc analysis
	// (inductors shorted and capacitors opened)
        Device.prototype.load_dc = function(ckt,soln,rhs) {
	}

	// load linear system equations for tran analysis
	Device.prototype.load_tran = function(ckt,soln) {
	}

	// load linear system equations for ac analysis:
	// current sources open, voltage sources shorted
	// linear models at operating point for everyone else
	Device.prototype.load_ac = function(ckt,rhs) {
	}

	// return time of next breakpoint for the device
	Device.prototype.breakpoint = function(time) {
	    return undefined;
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Parse numbers in engineering notation
	//
	///////////////////////////////////////////////////////////////////////////////

	// convert first character of argument into an integer
	function ord(ch) {
	    return ch.charCodeAt(0);
	}

	// convert string argument to a number, accepting usual notations
	// (hex, octal, binary, decimal, floating point) plus engineering
	// scale factors (eg, 1k = 1000.0 = 1e3).
	// return default if argument couldn't be interpreted as a number
	function parse_number(x,default_v) {
	    var m;

	    m = x.match(/^\s*([-+]?)0x([0-9a-fA-F]+)\s*$/);  // hex
	    if (m) return parseInt(m[1]+m[2],16);

	    m = x.match(/^\s*([-+]?)0b([0-1]+)\s*$/);  // binary
	    if (m) return parseInt(m[1]+m[2],2);

	    m = x.match(/^\s*([-+]?)0([0-7]+)\s*$/);  // octal
	    if (m) return parseInt(m[1]+m[2],8);

	    m = x.match(/^\s*[-+]?[0-9]*(\.([0-9]+)?)?([eE][-+]?[0-9]+)?\s*$/);  // decimal, float
	    if (m) return parseFloat(m[0]);

	    m = x.match(/^\s*([-+]?[0-9]*(\.([0-9]+)?)?)(a|A|f|F|g|G|k|K|m|M|n|N|p|P|t|T|u|U)\s*$/);  // decimal, float
	    if (m) {
		var result = parseFloat(m[1]);
		var scale = m[4];
		if (scale == 'P') result *= 1e15;   // peta
		else if (scale == 't' || scale == 'T') result *= 1e12;  // tera
		else if (scale == 'g' || scale == 'G') result *= 1e9;   // giga
		else if (scale == 'M') result *= 1e6;  // mega
		else if (scale == 'k' || scale == 'K') result *= 1e3;  // kilo
		else if (scale == 'm') result *= 1e-3; // milli
		else if (scale == 'u' || scale == 'U') result *= 1e-6;  // micro
		else if (scale == 'n' || scale == 'N') result *= 1e-9;  // nano
		else if (scale == 'p') result *= 1e-12;  // pico
		else if (scale == 'f' || scale == 'F') result *= 1e-15; // femto
		else if (scale == 'a' || scale == 'A') result *= 1e-18; // atto
		return result;
	    }

	    return (default_v || NaN);
	}

	/*
	// convert string argument to a number, accepting usual notations
	// (hex, octal, binary, decimal, floating point) plus engineering
	// scale factors (eg, 1k = 1000.0 = 1e3).
	// return default if argument couldn't be interpreted as a number
	function xparse_number(s,default_v) {
	    var slen = s.length;
	    var multiplier = 1;
	    var result = 0;
	    var index = 0;

	    // skip leading whitespace
	    while (index < slen && s.charAt(index) <= ' ') index += 1;
	    if (index == slen) return default_v;

	    // check for leading sign
	    if (s.charAt(index) == '-') {
		multiplier = -1;
		index += 1;
	    } else if (s.charAt(index) == '+')
		index += 1;
	    var start = index;   // remember where digits start

	    // if leading digit is 0, check for hex, octal or binary notation
	    if (index >= slen) return default_v;
	    else if (s.charAt(index) == '0') {
		index += 1;
		if (index >= slen) return 0;
		if (s.charAt(index) == 'x' || s.charAt(index) == 'X') { // hex
		    while (true) {
			index += 1;
			if (index >= slen) break;
			if (s.charAt(index) >= '0' && s.charAt(index) <= '9')
			    result = result*16 + ord(s.charAt(index)) - ord('0');
			else if (s.charAt(index) >= 'A' && s.charAt(index) <= 'F')
			    result = result*16 + ord(s.charAt(index)) - ord('A') + 10;
			else if (s.charAt(index) >= 'a' && s.charAt(index) <= 'f')
			    result = result*16 + ord(s.charAt(index)) - ord('a') + 10;
			else break;
		    }
		    return result*multiplier;
		} else if (s.charAt(index) == 'b' || s.charAt(index) == 'B') {  // binary
		    while (true) {
			index += 1;
			if (index >= slen) break;
			if (s.charAt(index) >= '0' && s.charAt(index) <= '1')
			    result = result*2 + ord(s.charAt(index)) - ord('0');
			else break;
		    }
		    return result*multiplier;
		} else if (s.charAt(index) != '.') { // octal
		    while (true) {
			if (s.charAt(index) >= '0' && s.charAt(index) <= '7')
			    result = result*8 + ord(s.charAt(index)) - ord('0');
			else break;
			index += 1;
			if (index >= slen) break;
		    }
		    return result*multiplier;
		}
	    }
    
	    // read decimal integer or floating-point number
	    while (true) {
		if (s.charAt(index) >= '0' && s.charAt(index) <= '9')
		    result = result*10 + ord(s.charAt(index)) - ord('0');
		else break;
		index += 1;
		if (index >= slen) break;
	    }

	    // fractional part?
	    if (index < slen && s.charAt(index) == '.') {
		while (true) {
		    index += 1;
		    if (index >= slen) break;
		    if (s.charAt(index) >= '0' && s.charAt(index) <= '9') {
			result = result*10 + ord(s.charAt(index)) - ord('0');
			multiplier *= 0.1;
		    } else break;
		}
	    }

	    // if we haven't seen any digits yet, don't check
	    // for exponents or scale factors
	    if (index == start) return default_v;

	    // type of multiplier determines type of result:
	    // multiplier is a float if we've seen digits past
	    // a decimal point, otherwise it's an int or long.
	    // Up to this point result is an int or long.
	    result *= multiplier;

	    // now check for exponent or engineering scale factor.  If there
	    // is one, result will be a float.
	    if (index < slen) {
		var scale = s.charAt(index);
		index += 1;
		if (scale == 'e' || scale == 'E') {
		    var exponent = 0;
		    multiplier = 10.0;
		    if (index < slen) {
			if (s.charAt(index) == '+') index += 1;
			else if (s.charAt(index) == '-') {
			    index += 1;
			    multiplier = 0.1;
			}
		    }
		    while (index < slen) {
			if (s.charAt(index) >= '0' && s.charAt(index) <= '9') {
			    exponent = exponent*10 + ord(s.charAt(index)) - ord('0');
			    index += 1;
			} else break;
		    }
		    while (exponent > 0) {
			exponent -= 1;
			result *= multiplier;
		    }
		} else if (scale == 'P') result *= 1e15;   // peta
		else if (scale == 't' || scale == 'T') result *= 1e12;  // tera
		else if (scale == 'g' || scale == 'G') result *= 1e9;   // giga
		else if (scale == 'M') result *= 1e6;  // mega
		else if (scale == 'k' || scale == 'K') result *= 1e3;  // kilo
		else if (scale == 'm') result *= 1e-3; // milli
		else if (scale == 'u' || scale == 'U') result *= 1e-6;  // micro
		else if (scale == 'n' || scale == 'N') result *= 1e-9;  // nano
		else if (scale == 'p') result *= 1e-12;  // pico
		else if (scale == 'f' || scale == 'F') result *= 1e-15; // femto
		else if (scale == 'a' || scale == 'A') result *= 1e-18; // atto
	    }

	    // skip trailing whitespace, return default value if there
	    // non-whitespace trailing characters.
	    while (index < slen && s.charAt(index) <= ' ') index += 1;
	    if (index == slen) return result;
	    else return default_v;
	}
	*/

	Circuit.prototype.parse_number = parse_number;  // make it easy to call from outside

	// try to parse a number and generate an alert if there was a syntax error
	function parse_number_alert(s) {
	    var v = parse_number(s,undefined);

	    if (v == undefined)
		throw 'The string \"'+s+'\" could not be interpreted as an integer, a floating-point number or a number using engineering notation. Sorry, expressions are not allowed in this context.';

	    return v;
	}

	Circuit.prototype.parse_number_alert = parse_number_alert;  // make it easy to call from outside

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Sources
	//
	///////////////////////////////////////////////////////////////////////////////

	// argument is a string describing the source's value (see comments for details)
	// source types: dc,step,square,triangle,sin,pulse,pwl,pwl_repeating

	// returns an object with the following attributes:
	//   fun -- name of source function
	//   args -- list of argument values
	//   value(t) -- compute source value at time t
	//   inflection_point(t) -- compute time after t when a time point is needed
	//   dc -- value at time 0
	//   period -- repeat period for periodic sources (0 if not periodic)
	
	function parse_source(v) {
	    // generic parser: parse v as either <value> or <fun>(<value>,...)
	    var src = new Object();
	    src.period = 0; // Default not periodic
	    src.value = function(t) { return 0; }  // overridden below
	    src.inflection_point = function(t) { return undefined; };  // may be overridden below

	    // see if there's a "(" in the description
	    var index = v.indexOf('(');
	    var ch;
	    if (index >= 0) {
		src.fun = v.slice(0,index);   // function name is before the "("
		src.args = [];	// we'll push argument values onto this list
		var end = v.indexOf(')',index);
		if (end == -1) end = v.length;

		index += 1;     // start parsing right after "("
		while (index < end) {
		    // figure out where next argument value starts
		    ch = v.charAt(index);
		    if (ch <= ' ') { index++; continue; }
		    // and where it ends
		    var arg_end = v.indexOf(',',index);
		    if (arg_end == -1) arg_end = end;
		    // parse and save result in our list of arg values
		    src.args.push(parse_number_alert(v.slice(index,arg_end)));
		    index = arg_end + 1;
		}
	    } else {
		src.fun = 'dc';
		src.args = [parse_number_alert(v)];
	    }

	    // post-processing for constant sources
	    // dc(v)
	    if (src.fun == 'dc') {
		var v = arg_value(src.args,0,0);
		src.args = [v];
		src.value = function(t) { return v; }  // closure
	    }

	    // post-processing for impulse sources
	    // impulse(height,width)
	    else if (src.fun == 'impulse') {
		var h = arg_value(src.args,0,1);  // default height: 1
		var w = Math.abs(arg_value(src.args,2,1e-9));  // default width: 1ns
		src.args = [h,w];  // remember any defaulted values
		pwl_source(src,[0,0,w/2,h,w,0],false);
	    }

	    // post-processing for step sources
	    // step(v_init,v_plateau,t_delay,t_rise)
	    else if (src.fun == 'step') {
		var v1 = arg_value(src.args,0,0);  // default init value: 0V
		var v2 = arg_value(src.args,1,1);  // default plateau value: 1V
		var td = Math.max(0,arg_value(src.args,2,0));  // time step starts
		var tr = Math.abs(arg_value(src.args,3,1e-9));  // default rise time: 1ns
		src.args = [v1,v2,td,tr];  // remember any defaulted values
		pwl_source(src,[td,v1,td+tr,v2],false);
	    }

	    // post-processing for square wave
	    // square(v_init,v_plateau,freq,duty_cycle)
	    else if (src.fun == 'square') {
		var v1 = arg_value(src.args,0,0);  // default init value: 0V
		var v2 = arg_value(src.args,1,1);  // default plateau value: 1V
		var freq = Math.abs(arg_value(src.args,2,1));  // default frequency: 1Hz
		var duty_cycle  = Math.min(100,Math.abs(arg_value(src.args,3,50)));  // default duty cycle: 0.5
		src.args = [v1,v2,freq,duty_cycle];  // remember any defaulted values

		var per = freq == 0 ? Infinity : 1/freq;
		var t_change = 0.01 * per;   // rise and fall time
		var t_pw = .01 * duty_cycle * 0.98 * per;  // fraction of cycle minus rise and fall time
		pwl_source(src,[0,v1,t_change,v2,t_change+t_pw,
				v2,t_change+t_pw+t_change,v1,per,v1],true);
	    }

	    // post-processing for triangle
	    // triangle(v_init,v_plateua,t_period)
	    else if (src.fun == 'triangle') {
		var v1 = arg_value(src.args,0,0);  // default init value: 0V
		var v2 = arg_value(src.args,1,1);  // default plateau value: 1V
		var freq = Math.abs(arg_value(src.args,2,1));  // default frequency: 1s
		src.args = [v1,v2,freq];  // remember any defaulted values

		var per = freq == 0 ? Infinity : 1/freq;
		pwl_source(src,[0,v1,per/2,v2,per,v1],true);
	    }

	    // post-processing for pwl and pwlr sources
	    // pwl[r](t1,v1,t2,v2,...)
	    else if (src.fun == 'pwl' || src.fun == 'pwl_repeating') {
		pwl_source(src,src.args,src.fun == 'pwl_repeating');
	    }

	    // post-processing for pulsed sources
	    // pulse(v_init,v_plateau,t_delay,t_rise,t_fall,t_width,t_period)
	    else if (src.fun == 'pulse') {
		var v1 = arg_value(src.args,0,0);  // default init value: 0V
		var v2 = arg_value(src.args,1,1);  // default plateau value: 1V
		var td = Math.max(0,arg_value(src.args,2,0));  // time pulse starts
		var tr = Math.abs(arg_value(src.args,3,1e-9));  // default rise time: 1ns
		var tf = Math.abs(arg_value(src.args,4,1e-9));  // default rise time: 1ns
		var pw = Math.abs(arg_value(src.args,5,1e9));  // default pulse width: "infinite"
		var per = Math.abs(arg_value(src.args,6,1e9));  // default period: "infinite"
		src.args = [v1,v2,td,tr,tf,pw,per];

		var t1 = td;       // time when v1 -> v2 transition starts
		var t2 = t1 + tr;  // time when v1 -> v2 transition ends
		var t3 = t2 + pw;  // time when v2 -> v1 transition starts
		var t4 = t3 + tf;  // time when v2 -> v1 transition ends

		pwl_source(src,[t1,v1, t2,v2, t3,v2, t4,v1, per,v1],true);
	    }

	    // post-processing for sinusoidal sources
	    // sin(v_offset,v_amplitude,freq_hz,t_delay,phase_offset_degrees)
	    else if (src.fun == 'sin') {
		var voffset = arg_value(src.args,0,0);  // default offset voltage: 0V
		var va = arg_value(src.args,1,1);  // default amplitude: -1V to 1V
		var freq = Math.abs(arg_value(src.args,2,1));  // default frequency: 1Hz
		src.period = 1.0/freq;

		var td = Math.max(0,arg_value(src.args,3,0));  // default time delay: 0sec
		var phase = arg_value(src.args,4,0);  // default phase offset: 0 degrees
		src.args = [voffset,va,freq,td,phase];

		phase /= 360.0;

		// return value of source at time t
		src.value = function(t) {  // closure
		    if (t < td) return voffset + va*Math.sin(2*Math.PI*phase);
		    else return voffset + va*Math.sin(2*Math.PI*(freq*(t - td) + phase));
		}

		// return time of next inflection point after time t
		src.inflection_point = function(t) {	// closure
		    if (t < td) return td;
		    else return undefined;
		}
	    }
	
	    // object has all the necessary info to compute the source value and inflection points
	    src.dc = src.value(0);   // DC value is value at time 0
	    return src;
	}

	function pwl_source(src,tv_pairs,repeat) {
	    var nvals = tv_pairs.length;
	    if (repeat)
		src.period = tv_pairs[nvals-2];  // Repeat period of source
	    if (nvals % 2 == 1) npts -= 1;  // make sure it's even!

	    if (nvals <= 2) {
		// handle degenerate case
		src.value = function(t) { return nvals == 2 ? tv_pairs[1] : 0; }
		src.inflection_point = function(t) { return undefined; }
	    } else {
		src.value = function(t) { // closure
		    if (repeat)
			// make time periodic if values are to be repeated
			t = Math.fmod(t,tv_pairs[nvals-2]);
		    var last_t = tv_pairs[0];
		    var last_v = tv_pairs[1];
		    if (t > last_t) {
			var next_t,next_v;
			for (var i = 2; i < nvals; i += 2) {
			    next_t = tv_pairs[i];
			    next_v = tv_pairs[i+1];
			    if (next_t > last_t)  // defend against bogus tv pairs
				if (t < next_t)
				    return last_v + (next_v - last_v)*(t - last_t)/(next_t - last_t);
			    last_t = next_t;
			    last_v = next_v;
			}
		    }
		    return last_v;
		}
		src.inflection_point = function(t) {  // closure
		    if (repeat)
			// make time periodic if values are to be repeated
			t = Math.fmod(t,tv_pairs[nvals-2]);
		    for (var i = 0; i < nvals; i += 2) {
			var next_t = tv_pairs[i];
			if (t < next_t) return next_t;
		    }
		    return undefined;
		}
	    }
	}

	// helper function: return args[index] if present, else default_v
	function arg_value(args,index,default_v) {
	    if (index < args.length) {
		var result = args[index];
		if (result === undefined) result = default_v;
		return result;
	    } else return default_v;
	}

	// we need fmod in the Math library!
	Math.fmod = function(numerator,denominator) {
	    var quotient = Math.floor(numerator/denominator);
	    return numerator - quotient*denominator;
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Sources
	//
	///////////////////////////////////////////////////////////////////////////////

        function VSource(npos,nneg,branch,v) {
	    Device.call(this);
	    
	    this.src = parse_source(v);
	    this.npos = npos;
	    this.nneg = nneg;
	    this.branch = branch;
	}
	VSource.prototype = new Device();
	VSource.prototype.constructor = VSource;

	// load linear part for source evaluation
        VSource.prototype.load_linear = function(ckt) {
	    // MNA stamp for independent voltage source
	    ckt.add_to_Gl(this.branch,this.npos,1.0);
	    ckt.add_to_Gl(this.branch,this.nneg,-1.0);
	    ckt.add_to_Gl(this.npos,this.branch,1.0);
	    ckt.add_to_Gl(this.nneg,this.branch,-1.0);
	}

	// Source voltage added to b.
        VSource.prototype.load_dc = function(ckt,soln,rhs) {
	    ckt.add_to_rhs(this.branch,this.src.dc,rhs);  
	}

	// Load time-dependent value for voltage source for tran
        VSource.prototype.load_tran = function(ckt,soln,rhs,time) {
	    ckt.add_to_rhs(this.branch,this.src.value(time),rhs);  
	}

	// return time of next breakpoint for the device
	VSource.prototype.breakpoint = function(time) {
	    return this.src.inflection_point(time);
	}

	// small signal model ac value
        VSource.prototype.load_ac = function(ckt,rhs) {
	    ckt.add_to_rhs(this.branch,1.0,rhs);
	}

	function ISource(npos,nneg,v) {
	    Device.call(this);

	    this.src = parse_source(v);
	    this.npos = npos;
	    this.nneg = nneg;
	}
	ISource.prototype = new Device();
	ISource.prototype.constructor = ISource;

        ISource.prototype.load_linear = function(ckt) {
	    // Current source is open when off, no linear contribution
	}

	// load linear system equations for dc analysis
	ISource.prototype.load_dc = function(ckt,soln,rhs) {
	    var is = this.src.dc;

	    // MNA stamp for independent current source
	    ckt.add_to_rhs(this.npos,-is,rhs);  // current flow into npos
	    ckt.add_to_rhs(this.nneg,is,rhs);   // and out of nneg
	}

	// load linear system equations for tran analysis (just like DC)
        ISource.prototype.load_tran = function(ckt,soln,rhs,time) {
	    var is = this.src.value(time);

	    // MNA stamp for independent current source
	    ckt.add_to_rhs(this.npos,-is,rhs);  // current flow into npos
	    ckt.add_to_rhs(this.nneg,is,rhs);   // and out of nneg
	}

	// return time of next breakpoint for the device
	ISource.prototype.breakpoint = function(time) {
	    return this.src.inflection_point(time);
	}

	// small signal model: open circuit
        ISource.prototype.load_ac = function(ckt,rhs) {
	    // MNA stamp for independent current source
	    ckt.add_to_rhs(this.npos,-1.0,rhs);  // current flow into npos
	    ckt.add_to_rhs(this.nneg,1.0,rhs);   // and out of nneg
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Resistor
	//
	///////////////////////////////////////////////////////////////////////////////

	function Resistor(n1,n2,v) {
	    Device.call(this);
	    this.n1 = n1;
	    this.n2 = n2;
	    this.g = 1.0/v;
	}
	Resistor.prototype = new Device();
	Resistor.prototype.constructor = Resistor;

        Resistor.prototype.load_linear = function(ckt) {
	    // MNA stamp for admittance g
	    ckt.add_conductance_l(this.n1,this.n2,this.g);
	}

	Resistor.prototype.load_dc = function(ckt) {
	    // Nothing to see here, move along.
	}

	Resistor.prototype.load_tran = function(ckt,soln) {
	}

	Resistor.prototype.load_ac = function(ckt) {
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Diode
	//
	///////////////////////////////////////////////////////////////////////////////

	function Diode(n1,n2,v,type) {
	    Device.call(this);
	    this.anode = n1;
	    this.cathode = n2;
	    this.area = v;
	    this.type = type;  // 'normal' or 'ideal'
	    this.is = 1.0e-14;
	    this.ais = this.area * this.is;
	    this.vt = (type == 'normal') ? 25.8e-3 : 0.1e-3;  // 26mv or .1mv
	    this.exp_arg_max = 50;  // less than single precision max.
	    this.exp_max = Math.exp(this.exp_arg_max);
	}
	Diode.prototype = new Device();
        Diode.prototype.constructor = Diode;

        Diode.prototype.load_linear = function(ckt) {
	    // Diode is not linear, has no linear piece.
	}

        Diode.prototype.load_dc = function(ckt,soln,rhs) {
	    var vd = ckt.get_two_terminal(this.anode, this.cathode, soln);
	    var exp_arg = vd / this.vt;
	    var temp1, temp2;
	    // Estimate exponential with a quadratic if arg too big.
	    var abs_exp_arg = Math.abs(exp_arg);
	    var d_arg = abs_exp_arg - this.exp_arg_max;
	    if (d_arg > 0) {
		var quad = 1 + d_arg + 0.5*d_arg*d_arg;
		temp1 = this.exp_max * quad;
		temp2 = this.exp_max * (1 + d_arg);
	    } else {
		temp1 = Math.exp(abs_exp_arg);
		temp2 = temp1;
	    }
	    if (exp_arg < 0) {  // Use exp(-x) = 1.0/exp(x)
		temp1 = 1.0/temp1;
		temp2 = (temp1*temp2)*temp1;
	    }
	    var id = this.ais * (temp1 - 1);
	    var gd = this.ais * (temp2 / this.vt);

	    // MNA stamp for independent current source
	    ckt.add_to_rhs(this.anode,-id,rhs);  // current flows into anode
	    ckt.add_to_rhs(this.cathode,id,rhs);   // and out of cathode
	    ckt.add_conductance(this.anode,this.cathode,gd);
	}

        Diode.prototype.load_tran = function(ckt,soln,rhs,time) {
	    this.load_dc(ckt,soln,rhs);
	}

	Diode.prototype.load_ac = function(ckt) {
	}


	///////////////////////////////////////////////////////////////////////////////
	//
	//  Capacitor
	//
	///////////////////////////////////////////////////////////////////////////////

	function Capacitor(n1,n2,v) {
	    Device.call(this);
	    this.n1 = n1;
	    this.n2 = n2;
	    this.value = v;
	}
	Capacitor.prototype = new Device();
	Capacitor.prototype.constructor = Capacitor;

        Capacitor.prototype.load_linear = function(ckt) {
	    // MNA stamp for capacitance matrix 
	    ckt.add_capacitance(this.n1,this.n2,this.value);
	}

	Capacitor.prototype.load_dc = function(ckt,soln,rhs) {
	}

	Capacitor.prototype.load_ac = function(ckt) {
	}

	Capacitor.prototype.load_tran = function(ckt) {
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Inductor
	//
	///////////////////////////////////////////////////////////////////////////////

	function Inductor(n1,n2,branch,v) {
	    Device.call(this);
	    this.n1 = n1;
	    this.n2 = n2;
	    this.branch = branch;
	    this.value = v;
	}
	Inductor.prototype = new Device();
	Inductor.prototype.constructor = Inductor;

        Inductor.prototype.load_linear = function(ckt) {
	    // MNA stamp for inductor linear part
	    // L on diag of C because L di/dt = v(n1) - v(n2)
	    ckt.add_to_Gl(this.n1,this.branch,1);
	    ckt.add_to_Gl(this.n2,this.branch,-1);
	    ckt.add_to_Gl(this.branch,this.n1,-1);
	    ckt.add_to_Gl(this.branch,this.n2,1);
	    ckt.add_to_C(this.branch,this.branch,this.value)
	}

	Inductor.prototype.load_dc = function(ckt,soln,rhs) {
	    // Inductor is a short at dc, so is linear.
	}

	Inductor.prototype.load_ac = function(ckt) {
	}

	Inductor.prototype.load_tran = function(ckt) {
	}



	///////////////////////////////////////////////////////////////////////////////
	//
	//  Simple Voltage-Controlled Voltage Source Op Amp model 
	//
	///////////////////////////////////////////////////////////////////////////////

        function Opamp(np,nn,no,ng,branch,A,name) {
	    Device.call(this);
	    this.np = np;
	    this.nn = nn;
	    this.no = no;
	    this.ng = ng;
	    this.branch = branch;
	    this.gain = A;
	    this.name = name;
	}

	Opamp.prototype = new Device();
        Opamp.prototype.constructor = Opamp;
        
        Opamp.prototype.load_linear = function(ckt) {
            // MNA stamp for VCVS: 1/A(v(no) - v(ng)) - (v(np)-v(nn))) = 0.
	    var invA = 1.0/this.gain;
	    ckt.add_to_Gl(this.no,this.branch,1);
	    ckt.add_to_Gl(this.ng,this.branch,-1);
	    ckt.add_to_Gl(this.branch,this.no,invA);
	    ckt.add_to_Gl(this.branch,this.ng,-invA);
	    ckt.add_to_Gl(this.branch,this.np,-1);
	    ckt.add_to_Gl(this.branch,this.nn,1);
	}

	Opamp.prototype.load_dc = function(ckt,soln,rhs) {
	    // Op-amp is linear.
	}

	Opamp.prototype.load_ac = function(ckt) {
	}

	Opamp.prototype.load_tran = function(ckt) {
	}



	///////////////////////////////////////////////////////////////////////////////
	//
	//  Simplified MOS FET with no bulk connection and no body effect.
	//
	///////////////////////////////////////////////////////////////////////////////

	// approx. SPICE params for MOSIS 0.25u TSMC process
	//  scale factor = 0.25u
	//  nfet: vth = 0.5V, K' = 120 uA/V**2
        //  pfet: vth = -0.5V, K' = -25 uA/V**2
        //  diffusions: area cap = 2000 aF/um**2, perimeter cap = 500 aF/um
        //  gate cap = 6000 aF/um**2

        function Fet(d,g,s,W,L,name,type) {
	    if (type != 'n' && type != 'p') throw name+' fet type is not n or p';

	    Device.call(this);
	    this.d = d;
	    this.g = g;
	    this.s = s;
	    this.name = name;
	    this.W = W;
	    this.L = L;
	    this.ratio = W/L;
	    this.type_sign = (type == 'n') ? 1 : -1;
	    this.vt = 0.5;
	    this.kp = (type == 'n') ? 120e-6 : 25e-6;
            this.beta = this.kp * this.ratio;
	    this.lambda = 0.05;
	}
	Fet.prototype = new Device();
        Fet.prototype.constructor = Fet;

        Fet.prototype.load_linear = function(ckt) {
	    // FET channels are nonlinear, just like javascript progammers

	    // in the absence of a bulk terminal, use the ground node

	    // diffusion capacitances.  No sidewall cap on channel-side.
	    var W = this.W * 0.25;
	    var L = 4 * 0.25;   // assume diffusions are 4 lambda wide.
	    ckt.add_capacitance(this.d,ckt.gnd_node(),(2000e-18)*W*L + (500e-18)*(W + 2*L));
	    ckt.add_capacitance(this.s,ckt.gnd_node(),(2000e-18)*W*L + (500e-18)*(W + 2*L));

	    // gate capacitance
	    L = this.L * 0.25;
	    ckt.add_capacitance(this.g,ckt.gnd_node(),(6000e-18)*W*L);
	}

        Fet.prototype.load_dc = function(ckt,soln,rhs) {
	    var vds = this.type_sign * ckt.get_two_terminal(this.d, this.s, soln);
	    if (vds < 0) { // Drain and source have swapped roles
		var temp = this.d;
		this.d = this.s;
		this.s = temp;
		vds = this.type_sign * ckt.get_two_terminal(this.d, this.s, soln);
	    }
	    var vgs = this.type_sign * ckt.get_two_terminal(this.g, this.s, soln);
	    var vgst = vgs - this.vt;
	    with (this) {
		var gmgs,ids,gds;
		if (vgst > 0.0 ) { // vgst < 0, transistor off, no subthreshold here.
		    if (vgst < vds) { /* Saturation. */
			gmgs =  beta * (1 + (lambda * vds)) * vgst;
			ids = type_sign * 0.5 * gmgs * vgst;
			gds = 0.5 * beta * vgst * vgst * lambda;
		    } else {  /* Linear region */
			gmgs =  beta * (1 + lambda * vds);
			ids = type_sign * gmgs * vds * (vgst - 0.50 * vds);
			gds = gmgs * (vgst - vds) + beta * lambda * vds * (vgst - 0.5 * vds);
			gmgs *= vds;
		    }
		    ckt.add_to_rhs(d,-ids,rhs);  // current flows into the drain
		    ckt.add_to_rhs(s, ids,rhs);   // and out the source		    
		    ckt.add_conductance(d,s,gds);
		    ckt.add_to_G(s,s, gmgs);
		    ckt.add_to_G(d,s,-gmgs);
		    ckt.add_to_G(d,g, gmgs);
		    ckt.add_to_G(s,g,-gmgs);
		}
	    }
	}

	Fet.prototype.load_tran = function(ckt,soln,rhs) {
	    this.load_dc(ckt,soln,rhs);
	}

	Fet.prototype.load_ac = function(ckt) {
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Graphing
	//
	///////////////////////////////////////////////////////////////////////////////

	// add dashed lines!
	// from http://davidowens.wordpress.com/2010/09/07/html-5-canvas-and-dashed-lines/
	CanvasRenderingContext2D.prototype.dashedLineTo = function(fromX, fromY, toX, toY, pattern) {
	    // Our growth rate for our line can be one of the following:
	    //   (+,+), (+,-), (-,+), (-,-)
	    // Because of this, our algorithm needs to understand if the x-coord and
	    // y-coord should be getting smaller or larger and properly cap the values
	    // based on (x,y).
	    var lt = function (a, b) { return a <= b; };
	    var gt = function (a, b) { return a >= b; };
	    var capmin = function (a, b) { return Math.min(a, b); };
	    var capmax = function (a, b) { return Math.max(a, b); };

	    var checkX = { thereYet: gt, cap: capmin };
	    var checkY = { thereYet: gt, cap: capmin };

	    if (fromY - toY > 0) {
		checkY.thereYet = lt;
		checkY.cap = capmax;
	    }
	    if (fromX - toX > 0) {
		checkX.thereYet = lt;
		checkX.cap = capmax;
	    }

	    this.moveTo(fromX, fromY);
	    var offsetX = fromX;
	    var offsetY = fromY;
	    var idx = 0, dash = true;
	    while (!(checkX.thereYet(offsetX, toX) && checkY.thereYet(offsetY, toY))) {
		var ang = Math.atan2(toY - fromY, toX - fromX);
		var len = pattern[idx];

		offsetX = checkX.cap(toX, offsetX + (Math.cos(ang) * len));
		offsetY = checkY.cap(toY, offsetY + (Math.sin(ang) * len));

		if (dash) this.lineTo(offsetX, offsetY);
		else this.moveTo(offsetX, offsetY);

		idx = (idx + 1) % pattern.length;
		dash = !dash;
	    }
	};

	// given a range of values, return a new range [vmin',vmax'] where the limits
	// have been chosen "nicely".  Taken from matplotlib.ticker.LinearLocator
	function view_limits(vmin,vmax) {
	    // deal with degenerate case...
	    if (vmin == vmax) {
		if (vmin == 0) { vmin = -0.5; vmax = 0.5; }
		else {
		    vmin = vmin > 0 ? 0.9*vmin : 1.1*vmin;
		    vmax = vmax > 0 ? 1.1*vmax : 0.9*vmax;
		}
	    }

	    var log_range = Math.log(vmax - vmin)/Math.LN10;
	    var exponent = Math.floor(log_range);
	    //if (log_range - exponent < 0.5) exponent -= 1;
	    var scale = Math.pow(10,-exponent);
	    vmin = Math.floor(scale*vmin)/scale;
	    vmax = Math.ceil(scale*vmax)/scale;

	    return [vmin,vmax,1.0/scale];
	}

	var grid_pattern = [1,2];
	var cursor_pattern = [5,5];

	var normal_style = 'rgb(0,0,0)';  // default drawing color
	var background_style = 'rgb(210,210,210)';
	var element_style = 'rgb(255,255,255)';
	var grid_style = "rgb(128,128,128)";
	var graph_font = '10pt sans-serif';
	var graph_legend_font = '12pt sans-serif';

	var probe_colors_rgb = {
	    'red': 'rgb(255,64,64)',
	    'green': 'rgb(64,255,64)',
	    'blue': 'rgb(64,64,255)',
	    'cyan': 'rgb(64,255,255)',
	    'magenta' : 'rgb(255,64,255)',
	    'yellow': 'rgb(255,255,64)',
	    'black': 'rgb(0,0,0)',
	    'x-axis': undefined,
	};

	// x_values is an array of x coordinates for each of the plots
	// y_values is an array of [color, value_array], one entry for each plot on left vertical axis
	// z_values is an array of [color, value_array], one entry for each plot on right vertical axis
	function graph(x_values,x_legend,y_values,y_legend,z_values,z_legend) {
	    var canvas = document.createElement('canvas');
	    canvas.bg_image = document.createElement('canvas');

	    // save info need for interactions with the graph
	    canvas.x_values = x_values;
	    canvas.y_values = y_values;
	    canvas.z_values = z_values;
	    canvas.x_legend = x_legend;
	    canvas.y_legend = y_legend;
	    canvas.z_legend = y_legend;
	    canvas.cursor1_x = undefined;
	    canvas.cursor2_x = undefined;

	    // find max and min values
	    canvas.x_min = array_min(x_values);
	    canvas.x_max = array_max(x_values);

	    var y_min = Infinity;
	    var y_max = -Infinity;
	    if (y_values != undefined && y_values.length > 0)
		for (var plot = y_values.length - 1; plot >= 0; plot -= 1) {
		    var values = y_values[plot][2];
		    if (values == undefined) continue;  // no data points
		    var offset = y_values[plot][1];
		    var temp = array_min(values) + offset;
		    if (temp < y_min) y_min = temp;
		    temp = array_max(values) + offset;
		    if (temp > y_max) y_max = temp;
		}
	    canvas.y_min = y_min;
	    canvas.y_max = y_max;

	    var z_min = Infinity;
	    var z_max = -Infinity;
	    if (z_values != undefined && z_values.length > 0)
		for (plot = z_values.length - 1; plot >= 0; plot -= 1) {
		    var values = z_values[plot][2];
		    if (values == undefined) continue;  // no data points
		    var offset = z_values[plot][1];
		    var temp = array_min(values) + offset;
		    if (temp < z_min) z_min = temp;
		    temp = array_max(values) + offset;
		    if (temp > z_max) z_max = temp;
		}
	    canvas.z_min = z_min;
	    canvas.z_max = z_max;

	    // do something useful when user mouses over graph
	    $(canvas).mousemove(graph_mouse_move);

	    canvas.resize = do_plot;  // for future resizing operations
	    do_plot(canvas,400,300);

	    //var d = document.createElement('div');
	    //d.appendChild(canvas);
	    //return d;
	    return canvas;
	}

	function do_plot(canvas,w,h) {
	    var x_values = canvas.x_values;
	    var y_values = canvas.y_values;
	    var z_values = canvas.z_values;

	    var left_margin = (y_values != undefined && y_values.length > 0) ? 55 : 25;
	    var top_margin = 25;
	    var right_margin = (z_values != undefined && z_values.length > 0) ? 55 : 25;
	    var bottom_margin = 45;
	    var tick_length = 5;

	    var pwidth = w - left_margin - right_margin;
	    var pheight = h - top_margin - bottom_margin;

	    canvas.width = w;
	    canvas.height = h;
	    canvas.bg_image.width = w;
	    canvas.bg_image.height = h;

	    // start by painting an opaque background
	    var c = canvas.bg_image.getContext('2d');
	    //c.fillStyle = background_style;
	    //c.fillRect(0,0,w,h);
	    c.clearRect(0,0,w,h);
	    c.fillStyle = element_style;
	    c.fillRect(left_margin,top_margin,pwidth,pheight);

	    // figure out scaling for plots
	    var x_limits = view_limits(canvas.x_min,canvas.x_max);
	    var x_min = x_limits[0];
	    var x_max = x_limits[1];
	    var x_scale = pwidth/(x_max - x_min);

	    function plot_x(x) {
		return (x - x_min)*x_scale + left_margin;
	    }

	    // draw x grid
	    c.strokeStyle = grid_style;
	    c.lineWidth = 1;
	    c.fillStyle = normal_style;
	    c.font = graph_font;
	    c.textAlign = 'center';
	    c.textBaseline = 'top';
	    var end = top_margin + pheight;
	    for (var x = x_min; x <= x_max; x += x_limits[2]) {
		var temp = plot_x(x) + 0.5;  // keep lines crisp!

		// grid line
		c.beginPath();
		if (x == x_min) {
		    c.moveTo(temp,top_margin);
		    c.lineTo(temp,end);
		} else 
		    c.dashedLineTo(temp,top_margin,temp,end,grid_pattern);
		c.stroke();

		// tick mark
		c.beginPath();
		c.moveTo(temp,end);
		c.lineTo(temp,end + tick_length);
		c.stroke();
		c.fillText(jade.engineering_notation(x,2),temp,end + tick_length);
	    }

	    var y_min,y_max,y_scale;
	    if (y_values != undefined && y_values.length > 0) {
		var y_limits = view_limits(canvas.y_min,canvas.y_max);
		y_min = y_limits[0];
		y_max = y_limits[1];
		y_scale = pheight/(y_max - y_min);

		function plot_y(y) {
		    return (y_max - y)*y_scale + top_margin;
		}

		// draw y grid
		c.textAlign = 'right';
		c.textBaseline = 'middle';
		for (var y = y_min; y <= y_max; y += y_limits[2]) {
		    if (Math.abs(y/y_max) < 0.001) y = 0.0; // Just 3 digits
		    var temp = plot_y(y) + 0.5;  // keep lines crisp!

		    // grid line
		    c.beginPath();
		    if (y == y_min) {
			c.moveTo(left_margin,temp);
			c.lineTo(left_margin + pwidth,temp);
		    } else 
			c.dashedLineTo(left_margin,temp,left_margin + pwidth,temp,grid_pattern);
		    c.stroke();

		    // tick mark
		    c.beginPath();
		    c.moveTo(left_margin - tick_length,temp);
		    c.lineTo(left_margin,temp);
		    c.stroke();
		    c.fillText(jade.engineering_notation(y,2),left_margin - tick_length -2,temp);
		}

		// now draw each plot
		var x,y;
		var nx,ny;
		c.lineWidth = 3;
		c.lineCap = 'round';
		for (plot = y_values.length - 1; plot >= 0; plot -= 1) {
		    var color = probe_colors_rgb[y_values[plot][0]];
		    if (color == undefined) continue;  // no plot color (== x-axis)
		    c.strokeStyle = color;
		    var values = y_values[plot][2];
		    if (values == undefined) continue;  // no data points
		    var offset = y_values[plot][1];

		    x = plot_x(x_values[0]);
		    y = plot_y(values[0] + offset);
		    c.beginPath();
		    c.moveTo(x,y);
		    for (var i = 1; i < x_values.length; i += 1) {
			nx = plot_x(x_values[i]);
			ny = plot_y(values[i] + offset);
			c.lineTo(nx,ny);
			x = nx;
			y = ny;
			if (i % 100 == 99) {
			    // too many lineTo's cause canvas to break
			    c.stroke();
			    c.beginPath();
			    c.moveTo(x,y);
			}
		    }
		    c.stroke();
		}
	    }

	    var z_min,z_max,z_scale;
	    if (z_values != undefined && z_values.length > 0) {
		var z_limits = view_limits(canvas.z_min,canvas.z_max);
		z_min = z_limits[0];
		z_max = z_limits[1];
		z_scale = pheight/(z_max - z_min);

		function plot_z(z) {
		    return (z_max - z)*z_scale + top_margin;
		}

		// draw z ticks
		c.textAlign = 'left';
		c.textBaseline = 'middle';
		c.lineWidth = 1;
		c.strokeStyle = normal_style;
		var tick_length_half = Math.floor(tick_length/2);
		var tick_delta = tick_length - tick_length_half;
		for (var z = z_min; z <= z_max; z += z_limits[2]) {
		    if (Math.abs(z/z_max) < 0.001) z = 0.0; // Just 3 digits
		    var temp = plot_z(z) + 0.5;  // keep lines crisp!

		    // tick mark
		    c.beginPath();
		    c.moveTo(left_margin + pwidth - tick_length_half,temp);
		    c.lineTo(left_margin + pwidth + tick_delta,temp);
		    c.stroke();
		    c.fillText(jade.engineering_notation(z,2),left_margin + pwidth + tick_length + 2,temp);
		}

		var z;
		var nz;
		c.lineWidth = 3;
		for (plot = z_values.length - 1; plot >= 0; plot -= 1) {
		    var color = probe_colors_rgb[z_values[plot][0]];
		    if (color == undefined) continue;  // no plot color (== x-axis)
		    c.strokeStyle = color;
		    var values = z_values[plot][2];
		    if (values == undefined) continue;  // no data points
		    var offset = z_values[plot][1];
		    
		    x = plot_x(x_values[0]);
		    z = plot_z(values[0] + offset);
		    c.beginPath();
		    c.moveTo(x,z);
		    for (var i = 1; i < x_values.length; i += 1) {
			nx = plot_x(x_values[i]);
			nz = plot_z(values[i] + offset);
			c.lineTo(nx,nz);
			x = nx;
			z = nz;
			if (i % 100 == 99) {
			    // too many lineTo's cause canvas to break
			    c.stroke();
			    c.beginPath();
			    c.moveTo(x,z);
			}
		    }
		    c.stroke();
		}
	    }

	    // draw legends
	    c.font = graph_legend_font;
	    c.textAlign = 'center';
	    c.textBaseline = 'bottom';
	    c.fillText(canvas.x_legend,left_margin + pwidth/2,h - 5);

	    if (y_values != undefined && y_values.length > 0) {
		c.textBaseline = 'top';
		c.save();
		c.translate(5 ,top_margin + pheight/2);
		c.rotate(-Math.PI/2);
		c.fillText(canvas.y_legend,0,0);
		c.restore();
	    }

	    if (z_values != undefined && z_values.length > 0) {
		c.textBaseline = 'bottom';
		c.save();
		c.translate(w-5 ,top_margin + pheight/2);
		c.rotate(-Math.PI/2);
		c.fillText(canvas.z_legend,0,0);
		c.restore();
	    }

	    // save info for interaction handlers
	    canvas.x_min_final = x_min;
	    canvas.x_scale = x_scale;
	    //canvas.y_min_final = y_min;
	    canvas.y_scale = y_scale;
	    //canvas.z_min_final = z_min;
	    canvas.z_scale = z_scale;
	    canvas.left_margin = left_margin;
	    canvas.top_margin = top_margin;
	    canvas.pwidth = pwidth;
	    canvas.pheight = pheight;
	    canvas.tick_length = tick_length;

	    // return our masterpiece
	    redraw_plot(canvas);
	}

	function array_max(a) {
	    max = -Infinity;
	    for (var i = a.length - 1; i >= 0; i -= 1)
		if (a[i] > max) max = a[i];
	    return max;
	}

	function array_min(a) {
	    min = Infinity;
	    for (var i = a.length - 1; i >= 0; i -= 1)
		if (a[i] < min) min = a[i];
	    return min;
	}

	function plot_cursor(c,graph,cursor_x,left_margin) {
	    // draw dashed vertical marker that follows mouse
	    var x = graph.left_margin + cursor_x;
	    var end_y = graph.top_margin + graph.pheight + graph.tick_length;
	    c.strokeStyle = grid_style;
	    c.lineWidth = 1;
	    c.beginPath();
	    c.dashedLineTo(x,graph.top_margin,x,end_y,cursor_pattern);
	    c.stroke();

	    // add x label at bottom of marker
	    var graph_x = cursor_x/graph.x_scale + graph.x_min_final;
	    c.font = graph_font;
	    c.textAlign = 'center';
	    c.textBaseline = 'top';
	    c.fillStyle = background_style;
	    c.fillText('\u2588\u2588\u2588\u2588\u2588',x,end_y);
	    c.fillStyle = normal_style;
	    c.fillText(jade.engineering_notation(graph_x,3,false),x,end_y);

	    // compute which points marker is between
	    var x_values = graph.x_values;
	    var len = x_values.length;
	    var index = 0;
	    while (index < len && graph_x >= x_values[index]) index += 1;
	    var x1 = (index == 0) ? x_values[0] : x_values[index-1];
	    var x2 = x_values[index];

	    if (x2 != undefined) {
		// for each plot, interpolate and output value at intersection with marker
		c.textAlign = 'left';
		var tx = graph.left_margin + left_margin;
		var ty = graph.top_margin;
		if (graph.y_values != undefined) {
		    for (var plot = 0; plot < graph.y_values.length; plot += 1) {
			var values = graph.y_values[plot][2];
			var color = probe_colors_rgb[graph.y_values[plot][0]];
			if (values == undefined || color == undefined) continue;  // no data points or x-axis
		    
			// interpolate signal value at graph_x using values[index-1] and values[index]
			var y1 = (index == 0) ? values[0] : values[index-1];
			var y2 = values[index];
			var y = y1;
			if (graph_x != x1) y += (graph_x - x1)*(y2 - y1)/(x2 - x1);
		    
			// annotate plot with value of signal at marker
			c.fillStyle = element_style;
			c.fillText('\u2588\u2588\u2588\u2588\u2588',tx-3,ty);
			c.fillStyle = color;
			c.fillText(jade.engineering_notation(y,3,false),tx,ty);
			ty += 14;
		    }
		}

		c.textAlign = 'right';
		if (graph.z_values != undefined) {
		    var tx = graph.left_margin + graph.pwidth - left_margin;
		    var ty = graph.top_margin;
		    for (var plot = 0; plot < graph.z_values.length; plot += 1) {
			var values = graph.z_values[plot][2];
			var color = probe_colors_rgb[graph.z_values[plot][0]];
			if (values == undefined || color == undefined) continue;  // no data points or x-axis
		    
			// interpolate signal value at graph_x using values[index-1] and values[index]
			var z1 = (index == 0) ? values[0]: values[index-1];
			var z2 = values[index];
			var z = z1;
			if (graph_x != x1) z += (graph_x - x1)*(z2 - z1)/(x2 - x1);
		    
			// annotate plot with value of signal at marker
			c.fillStyle = element_style;
			c.fillText('\u2588\u2588\u2588\u2588\u2588',tx+3,ty);
			c.fillStyle = color;
			c.fillText(jade.engineering_notation(z,3,false),tx,ty);
			ty += 14;
		    }
		}
	    }
	}

	function redraw_plot(graph) {
	    var c = graph.getContext('2d');
	    c.clearRect(0,0,graph.width,graph.height);
	    c.drawImage(graph.bg_image,0,0);

	    if (graph.cursor1_x != undefined) plot_cursor(c,graph,graph.cursor1_x,4);
	    if (graph.cursor2_x != undefined) plot_cursor(c,graph,graph.cursor2_x,30);

	    /*
	    if (graph.cursor1_x != undefined) {
		// draw dashed vertical marker that follows mouse
		var x = graph.left_margin + graph.cursor1_x;
		var end_y = graph.top_margin + graph.pheight + graph.tick_length;
		c.strokeStyle = grid_style;
		c.lineWidth = 1;
		c.beginPath();
		c.dashedLineTo(x,graph.top_margin,x,end_y,cursor_pattern);
		c.stroke();

		// add x label at bottom of marker
		var graph_x = graph.cursor1_x/graph.x_scale + graph.x_min_final;
		c.font = '10pt sans-serif';
		c.textAlign = 'center';
		c.textBaseline = 'top';
		c.fillStyle = this.background_style;
		c.fillText('\u2588\u2588\u2588\u2588\u2588',x,end_y);
		c.fillStyle = normal_style;
		c.fillText(jade.engineering_notation(graph_x,3,false),x,end_y);

		// compute which points marker is between
		var x_values = graph.x_values;
		var len = x_values.length;
		var index = 0;
		while (index < len && graph_x >= x_values[index]) index += 1;
		var x1 = (index == 0) ? x_values[0] : x_values[index-1];
		var x2 = x_values[index];

		if (x2 != undefined) {
		    // for each plot, interpolate and output value at intersection with marker
		    c.textAlign = 'left';
		    var tx = graph.left_margin + 4;
		    var ty = graph.top_margin;
		    for (var plot = 0; plot < graph.y_values.length; plot += 1) {
			var values = graph.y_values[plot][1];

			// interpolate signal value at graph_x using values[index-1] and values[index]
			var y1 = (index == 0) ? values[0] : values[index-1];
			var y2 = values[index];
			var y = y1;
			if (graph_x != x1) y += (graph_x - x1)*(y2 - y1)/(x2 - x1);

			// annotate plot with value of signal at marker
			c.fillStyle = element_style;
			c.fillText('\u2588\u2588\u2588\u2588\u2588',tx-3,ty);
			c.fillStyle = probe_colors_rgb[graph.y_values[plot][0]];
			c.fillText(jade.engineering_notation(y,3,false),tx,ty);
			ty += 14;
		    }
		}
	    }
	    */
	}

	function graph_mouse_move(event) {
	    var g = event.target;

	    var pos = $(g).offset();
	    g.mouse_x = event.pageX - pos.left;
	    g.mouse_y = event.pageY - pos.top;

	    // not sure yet where the 3,-3 offset correction comes from (borders? padding?)
	    var gx = g.mouse_x - g.left_margin - 3;
	    var gy = g.pheight - (g.mouse_y - g.top_margin) + 3;
	    if (gx >= 0 && gx <= g.pwidth && gy >=0 && gy <= g.pheight) {
		g.cursor1_x = gx;
	    } else {
		g.cursor1_x = undefined;
		g.cursor2_x = undefined;
	    }

	    redraw_plot(g);
	}

	///////////////////////////////////////////////////////////////////////////////
	//
	//  Module definition
	//
	///////////////////////////////////////////////////////////////////////////////
	var module = {
	    'Circuit': Circuit,
	    'parse_number': parse_number,
	    'parse_number_alert': parse_number_alert,
	    'parse_source': parse_source,
	}
	return module;
    }());
