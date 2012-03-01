////////////////////////////////////////////////////////////////////////////////
// Patch ExCSS
////////////////////////////////////////////////////////////////////////////////
function updateExCSSWithParsePrimitives() {
  var g = CSS.Grammar;
  var TransitionGraphGrammar = {
    statement: g.first(g.g('var_decl'), g.g('trait'), g.g('transition_graph'), 
                   g.g('ruleset'), g.g('keyframes')),
    transition_graph: [g.g('transition_graph_name'), g.SS, g.g('selector'), g.g('tg_body')],
    transition_graph_name: '@transition-graph',
    tg_body: ['{', g.SS, g.zeroOrMore(g.g('tg_item'), g.SS), g.zeroOrOne(g.g('tg_item_single'), g.SS), '}'],
    tg_item: g.first(g.g('ruleitem'), [g.g('tg_node'), g.oneOrMore(';')], g.g('tg_edge')),
    tg_item_single: g.first(g.g('ruleitem_single'), g.g('tg_node'), g.g('tg_edge')),
    tg_node: [g.g('tg_node_name'), g.SS, '(', g.SS, g.g('tg_node_values'), ')', g.SS, g.g('tg_node_spec'), g.SS],
    tg_node_spec: g.first(g.g('rulebody_nopop'), g.g('mixin_value')),
    rulebody_nopop: ['{', g.SS,
               g.zeroOrMore(g.g('ruleitem'), g.SS),
               g.zeroOrOne(g.g('ruleitem_single'), g.SS),
               '}'],
    tg_edge: [g.g('tg_edge_name'), g.SS, '(', g.SS, g.g('tg_edge_values'), ')', g.SS, g.g('rulebody'), g.SS],
    tg_edge_name: '@edge', // TODO: make tokens
    tg_node_name: '@node',
    tg_edge_values: g.g('values'),
    tg_node_values: g.g('values')
  };

  g.patch(TransitionGraphGrammar);

  CSS.CallbackRegistry.patch({
    transition_graph_name: function(s) {
      this.currentItems.push({ selector: "", rules: [], edges: [], nodes: [] });
      if (!this.jso.transitionGraphs) {
        this.jso.transitionGraphs = [];
      }
      this.jso.transitionGraphs.push(this.currentItem());
    },
    tg_body: function(s) {
      this.currentItems.pop();
    },
    tg_edge_name: function(s) {
      var edge = { rules: [] } 
      this.currentItem().edges.push(edge);
      this.currentItems.push(edge);
    },
    tg_edge_values: function(s) {
      this.currentItem().values = s;
    },
    tg_node_values: function(s) {
      this.currentItem().values = s;
    },
    tg_node_name: function(s) {
      this.currentItems.push({ rules: [] });
    },
    tg_node: function(s) {
      var node = this.currentItems.pop();
      this.currentItem().nodes.push({values: node.values, rules: node.rules});
    }
  });

  function mixinToProperties(mixin) {
    mixin = TRAITS.get(mixin.ident);
    return toDict(mixin.rules);
  }

  function expandProperties(rules) {
    var result = {};
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].mixin) {
        mixinResult = mixinToProperties(rules[i].mixin);
        for (o in mixinResult) {
          result[o] = mixinResult[o];
        }
      } else {
        var rule = rules[i].declaration.split(":")
        result[rule[0].trim()] = rule[1].trim();
      }
    }
    return result;
  }

  function toDict(rules) {
    var rDict = {}
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i].declaration.split(":")
      rDict[rule[0].trim()] = rule[1].trim();
    }
    return rDict;
  }

  function generateAnim(selector, rules, variables, from, to) {
    var rDict = toDict(rules);
    from = from || rDict["from"]
    to = to || rDict["to"]

    var animName = rDict["over"] + "_anim"
    var keyFrameName = rDict["over"] + "_" + (from == "*" ? "STAR" : from) + "-" + (to == "*" ? "STAR" : to)

    // TODO: handle animation lists
    var properties = undefined;
    var keyframe = undefined;
    if (rDict["animation"].indexOf("transition(") != 0) {
      var raw = rDict["animation"].split(" ");
      var keyframe = raw[0].trim();
      var cost = raw[1].trim();
    } else {
      var raw = rDict["animation"].substring(11).split(")")
      var properties = raw[0].split(",").map(function(a) {return a.trim()});
      var cost = raw[1].trim();
    }
    cost = Number(cost.substring(0, cost.length - 1))
    
    var result = selector + "[" + animName + "=\"" + keyFrameName + "\"] {\n" +
          "  -webkit-animation-name: " + keyFrameName + ";\n" +
          "  -webkit-animation-duration: " + cost + "s;\n" +
          "}\n";

    ExcssAnimation.addTransitionForSelector(selector, rDict["over"], from, to, cost, properties, keyframe);

    if ("direction" in rDict && rDict["direction"] == "both") {
      var rKeyFrameName = rDict["over"] + "_" + to + "-" + from
      result += selector + "[" + animName + "=\"" + rKeyFrameName + "\"] {\n" +
          "  -webkit-animation-name: " + rKeyFrameName + ";\n" +
          "  -webkit-animation-duration: " + cost + "s;\n" +
          "}\n";
      
      ExcssAnimation.addTransitionForSelector(selector, rDict["over"], from, to, cost, properties, keyframe, true);

    }
    return result;
  }

  function ppTransitionGraph(selector, rules, edges, nodes, variables) {
    var result = "";
    var rDict = toDict(rules);
    ExcssAnimation.addAnimNameForSelector(selector, rDict["over"]);
    for (var i = 0; i < edges.length; i++) {
      var locs = edges[i].values.split(",")
      var from = locs[0].trim();
      var to = locs[1].trim();
      result += generateAnim(selector, rules.concat(edges[i].rules), variables, from, to);
    }
    for (var i = 0; i < nodes.length; i++) {
      ExcssAnimation.addPropertiesForSelector(selector, rDict["over"], nodes[i].values.trim(), expandProperties(nodes[i].rules));
    }
    return result;
  }

  function findPhantomStyles(ruleset, vars) {
    ruleset.rules.forEach(function(rule) {
      if (rule.declaration && ruleset.selector) {
        var declaration = vars.substitute(rule.declaration);
        var splitDeclaration = declaration.split(":").map(function(a) { return a.trim(); });
        if (splitDeclaration[0].indexOf("state-") == 0) {
          CSSEmu.addPhantomStyle(ruleset.selector, splitDeclaration[0], splitDeclaration[1]);
        }
      }
      if (rule.nested) {
        findPhantomStyles(rule.nested, vars);
      }
    });
  }

  function handleTransitionGraphs(parseObject, vars) {
    var result = "";
    if (parseObject.transitionGraphs) {
      parseObject.transitionGraphs.forEach(function(transitionGraph) {
        result += ppTransitionGraph(transitionGraph.selector, transitionGraph.rules, transitionGraph.edges, transitionGraph.nodes, vars);
      });
    }

    parseObject.rulesets.forEach(function(ruleset) { findPhantomStyles(ruleset, vars); });

    parseObject.keyframes.forEach(ExcssAnimation.addKeyframes);

    return result;
  }

  CSS.Printer.registerExtension(handleTransitionGraphs);
}

updateExCSSWithParsePrimitives();
window.CSS.run();
