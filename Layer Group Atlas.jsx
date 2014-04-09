/*
	Layer Group to Image Atlas
	Tonio Loewald (c)2013
	Derived from earlier work written in 2011-2012
	
	Uses RectanglePacker.js 
	Iv·n Montes <drslump@drslump.biz>, <http://blog.netxus.es>
	
	Thanks also to Richard Dare, author of AtlasMaker -- http://richardjdare.com 
	without whom I wouldn't have found RectanglePacker
	
	Basic Idea
	1)  Build UI in Photoshop. Organize as layer groups (one group per element or
	    element-state) with a sensible naming convention (your choice).
	2)  Press a button in Photoshop.
	3)  You now have all the pieces in a single image ("image atlas"),
	4)  along with:
        - JSON containing metadata (the layer group names -> original image position
	    and dimensions, and the dimensions of the source layout), and
	    - Starling XML containing metadata (the layer group names -> original image position
	    and dimensions, and the dimensions of the source layout), and
    TODO:
	5)  CSS that provides a class for using each image as a sprite.
	
	Suggested naming convention:
	base-name[:state][.pin-x,pin-y], 
	
	e.g.
	continue.0,0 -- the layer group is named continue and is pinned to the top-left
	continue:active.0.5,0.5 -- the layer group is named continue:active and is pinned
        to the center of the view.
	
	Note that the [:state] component is merely part of the item name. How you utilize it
	is entirely up to you. (However, it will map nicely to CSS selectors, where the CSS
	rule for the sprite would end up being .continue:active { .... }.
	
	Image pinning is expressed as a pair of coordinates in [0,1], corresponding to the
	position within the view.
	
	Special Layer Names
	
	.foo
	If the layer name starts with a period then it is treated as a "comment" and skipped.
	
	_foo
	If the layer name starts with an underscore its metadata (position, etc.) will be
	exported but the image won't be added to the atlas.
*/

// enable double clicking from the Macintosh Finder or the Windows Explorer
#target photoshop

#include "lib/RectanglePacker.js"

// in case we double clicked the file
app.bringToFront();

// debug level: 0-2 (0:disable, 1:break on error, 2:break at beginning)
$.level = 1;
// debugger; // launch debugger on next line

var renderBackgroundLayer = false;
var atlasSuffix = "";
var metadataSuffix = "";

/*
    the amount of empty space we'll put around each object in the atlas to ensure
    clean separation -- since there should be no rounding errors (2^n coordinate systems)
    a safetyMargin of 1 should be fine
*/
var safetyMargin = 1;


/* options dialog */
var optionsDialogResource = "dialog {  \
    orientation: 'column', \
    alignChildren: ['fill', 'top'],  \
    preferredSize:[300, 130], \
    text: 'Texture Atlas Options',  \
    margins:15, \
    \
    outputFolder: Group{ \
        orientation: 'row', \
        label: StaticText {text: 'Output: '}, \
        input: EditText { text: '', characters: 30, justify: 'left'}, \
        browseButton: Button { text: 'Browse', properties:{name:'browse'}, size: [120,24], alignment:['right', 'center'] } \
    }, \
    suffix: Group{ \
        orientation: 'row', \
        atlas: Group{ \
            orientation: 'row', \
            label: StaticText {text: 'Atlas Suffix:'}, \
            input: EditText { text: '', characters: 10, justify: 'left'} \
        }, \
        metadata: Group{ \
            orientation: 'row', \
            label: StaticText {text: 'MetaData Suffix:'}, \
            input: EditText { text: '', characters: 10, justify: 'left'} \
        } \
    }, \
    safetyMargin: Group{ \
        label: StaticText { text: 'Buffer:' } \
        input: EditText { text: '', characters: 2, justify: 'left'}, \
    }, \
    includeBackground: Group{ \
        input: Checkbox { text:'Include Background Layer', value: false } \
    }, \
    action: Group{ \
        cancelButton: Button { text: 'Cancel', properties:{name:'cancel'}, size: [120,24], alignment:['right', 'center'] }, \
        okayButton: Button { text: 'Okay', properties:{name:'okay'}, size: [120,24], alignment:['right', 'center'] }, \
    }\
}"

/* MAIN */

if( app.documents.length == 0 ){
	alert( "No document to process!" );
} else {
    var outputFolder = app.activeDocument.path;
    var win = new Window(optionsDialogResource);
    win.outputFolder.input.text = outputFolder;
    win.suffix.atlas.input.text = atlasSuffix;
    win.suffix.metadata.input.text = metadataSuffix;
    win.includeBackground.input.value = renderBackgroundLayer;
    win.safetyMargin.input.text = safetyMargin;

    win.outputFolder.browseButton.onClick = function() {
      outputFolder = Folder.selectDialog("Select a folder for the output files", outputFolder);
      win.outputFolder.input.text = outputFolder;
    };
    win.action.cancelButton.onClick = function() {
      win.close();
    };
    win.action.okayButton.onClick = function() {
      // read settings
      atlasSuffix = win.suffix.atlas.input.text;
      metadataSuffix = win.suffix.metadata.input.text;
      renderBackgroundLayer = win.includeBackground.input.value;
      safetyMargin = parseInt(win.safetyMargin.input.text);

      // act
      var ret = win.close();
      processLayers();
      return ret;
    };
    win.show();
}

function process_bounds( bounds ){
	var d = [];
	for( var i = 0; i < bounds.length; i++ ){
		var c = String(bounds[i]);
		c = c.split(' ');
		c = parseInt(c[0]);
		d.push( c );
	}
	d[2] -= d[0];
	d[3] -= d[1];
	return d.join(',');
}

function pad(i){
	if( i < 10 ){
		return "0" + i;
	} else {
		return "" + i;
	}
}

// PS stores coordinates as "xxx pixels"
function coord( bound ){
    var c = String(bound).split(' ');
    return parseInt(c[0]);
}

// extract document metadata
function documentMetadata( doc ){
    return {
        width: coord( doc.width ),
        height: coord( doc.height ),
        resolution: doc.resolution,
        name: (doc.name.split("."))[0],
        path: doc.path? doc.path.toString() : ''
    };
}

// extract metadata from layer
function layerMetadata( doc, layer_idx ){
    var layer = doc.layers[layer_idx],
        name_parts = layer.name.split('.'),
        pin = false,
        layer_data = {
            name: name_parts[0],
            left: coord(layer.bounds[0]),
            top: coord(layer.bounds[1]),
            width: coord(layer.bounds[2]) - coord(layer.bounds[0]),
            height: coord(layer.bounds[3]) - coord(layer.bounds[1]),
            pinX: 0.5, // center by default
            pinY: 0.5, // center by default
            layer_index: layer_idx,
            isBackgroundLayer: layer.isBackgroundLayer
        };
    if( name_parts.length > 1 ){
        name_parts.shift();
        pin = name_parts.join(".").split(",");
        if(pin.length == 2){
            layer_data.pinX = parseFloat(pin[0]);
            layer_data.pinY = parseFloat(pin[1]);
        }
    }
    
    // Layer bounds can exceed document bounds -- need to deal with this
    if( layer_data.left < 0 ){
        layer_data.width += layer_data.left;
        layer_data.left = 0;
    }
    if( layer_data.top < 0 ){
        layer_data.height += layer_data.top;
        layer_data.top = 0;
    }
    if( layer_data.width + layer_data.left > coord(doc.width) ){
        layer_data.width += coord(doc.width) - layer_data.width - layer_data.left;
    }
    if( layer_data.height + layer_data.height > coord(doc.height) ){
        layer_data.height += coord(doc.height) - layer_data.height - layer_data.top;
    }
    
    return layer_data;
}

function layerCompare(a,b) {
  if (a.width < b.width)
     return -1;
  if (a.width > b.width)
    return 1;
  return 0;
}

function shouldRenderLayerToAtlas( layer ){
    if( layer.name[0] === "_" ){
        return false;
    }
    if( layer.isBackgroundLayer == true ){
        return renderBackgroundLayer;
    }
    return true;
}

function buildAtlas( metadata ){
    var layers = metadata.layers.slice(0),
        w = 0,
        h = 0,
        used,
        done = false,
        atlas; 
        
    // sort layers from biggest to smallest to optimize atlas creation
    layers.sort(layerCompare);
    layers.reverse();
        
    /*
        we start with the smallest 2^m x 2^n rect that will contain the any
        individual layer, and try to fit our atlas in.
        
        If we fail we double the smaller dimension until we succeed.
    */
    
    // find minimum w and h such that every individual layer will fit
    for( var i = 0; i < layers.length; i++ ){
        var layer = layers[i];
        if( !shouldRenderLayerToAtlas(layer) ){
            continue;
        }
        if( layer.width + safetyMargin * 2 > w ){
            w = layer.width + safetyMargin * 2;
        }
        if( layer.height + safetyMargin * 2 > h ){
            h = layer.height + safetyMargin * 2;
        }
    }
    w = Math.pow( 2, Math.ceil( Math.log(w) / Math.log(2) ) );
    h = Math.pow( 2, Math.ceil( Math.log(h) / Math.log(2) ) );
    
    // create our initial atlas
    atlas = new NETXUS.RectanglePacker( w, h );
    
    while( !done ){
        atlas.reset(w, h);
        done = true;
        for( var i = 0; i < layers.length; i++ ){
            var layer = layers[i];
            
            // do not render underscored files
            if( !shouldRenderLayerToAtlas(layer) ){
                continue;
            }
            var packedOrigin = atlas.findCoords( layers[i].width + safetyMargin * 2, layers[i].height + safetyMargin * 2);
            if( packedOrigin !== null ){
                packedOrigin.x += safetyMargin;
                packedOrigin.y += safetyMargin;
                layer.packedOrigin = packedOrigin;
            } else {
                if( w < h ){
                    w *= 2;
                } else {
                    h *= 2;
                }
                
                done = false;
                break;
            }
        }
    }
    
    used = atlas.getDimensions();
    
    metadata.atlas = { width: w, height: h };
}

function getAtlasName(metadata) {
    return metadata.name + atlasSuffix;
}

function getMetadataName(metadata) {
    return metadata.name + metadataSuffix;
}

function renderAtlas( docRef, metadata ){
    var i,
        layers = metadata.layers,
        pngOptions = new PNGSaveOptions(),
        atlasDoc = app.documents.add(
            metadata.atlas.width, 
            metadata.atlas.height, 
            72, 
            getAtlasName(metadata), 
            NewDocumentMode.RGB, 
            DocumentFill.TRANSPARENT, 
            1
        );
    
    for( i = 0; i < layers.length; i++ ){
        var layer = layers[i],
            source = docRef.layers[layer.layer_index];
        
        // do not render underscored files
        if( !shouldRenderLayerToAtlas(layer) ){
            continue;
        }
        app.activeDocument = docRef;    
        source.visible = true;
        var region = [
            [layer.left, layer.top],
            [layer.left + layer.width, layer.top],
            [layer.left + layer.width, layer.top + layer.height],
            [layer.left, layer.top + layer.height],
            [layer.left, layer.top]
        ];
        docRef.selection.select( region );
        docRef.selection.copy( true ); // copy merged
        source.visible = false;
        region = [
            [layer.packedOrigin.x, layer.packedOrigin.y],
            [layer.packedOrigin.x + layer.width, layer.packedOrigin.y],
            [layer.packedOrigin.x + layer.width, layer.packedOrigin.y + layer.height],
            [layer.packedOrigin.x, layer.packedOrigin.y + layer.height],
            [layer.packedOrigin.x, layer.packedOrigin.y]
        ]
        app.activeDocument = atlasDoc;
        atlasDoc.selection.select( region );
        atlasDoc.paste();
    }
    
    atlasDoc.mergeVisibleLayers();
    atlasDoc.saveAs( new File( outputFolder + "/" + getAtlasName(metadata) + ".png" ), pngOptions );
    // atlasDoc.close( SaveOptions.DONOTSAVECHANGES );
}

function json_escape( s ){
    var output = "";
    for( var i = 0; i < s.length; i++ ){
        switch( s[i] ){
            case "\\":
                output += "\\\\";
                break;
            case "/":
                output += "\\/";
                break;
            case "\b":
                output += "\\b";
                break;
            case "\f":
                output += "\\f";
                break;
            case "\n":
                output += "\\n";
                break;
            case "\r":
                output += "\\r";
                break;
            case "\t":
                output += "\\t";
                break;
            case '"':
                output += "\\\"";
                break;
            default:
                output += s[i];
        }
    }
    return output;
}

// Quick and dirty json export
function json( o, indent ){
    var s = "",
        i,
        parts = [];
    
    if( indent === undefined ){
        indent = 0;
    }
    
    function indents( n ){
        var indent = "",
            i;
        for( i = 0; i < n; i++ ){
            indent += "  ";
        }
        return indent;
    }
    
    switch( typeof o ){
        case "number":
            s = o.toString();
            break;
        case "string":
            s = '"' + json_escape(o) + '"';
            break;
        case "object":
            if( typeof o.length === "number" ){
                s = indents( indent ) + '[\n';
                for( i = 0; i < o.length; i++ ){
                    parts.push( indents( indent + 1 ) + json( o[i], indent + 1 ) );
                }
                s += parts.join(",\n");
                s += '\n' + indents( indent ) + ']';
            } else {
                s = '{\n';
                for( i in o ){
                    if( typeof( o[i] ) !== 'function' ){
                        parts.push( indents( indent + 1 ) + '"' + json_escape(i) + '":' + json( o[i], indent + 1 ) );
                    }
                }
                s += parts.join(",\n");
                s += '\n' + indents( indent ) + '}';
            }
            break;
    }
    return s;
}

// Quick and dirty starling xml export
function starlingXml( metadata, indent ){
    var s = '',
        i,
        parts = [];
    
    // open TextureAtlas node
    s += '<TextureAtlas ';
    s += 'imagePath="' + getAtlasName(metadata) + '.png">';
    s += '\n';
    
    // output SubTexture nodes
	for( var i = 0; i < metadata.layers.length; i++ ){
        var layer = metadata.layers[i];
        if( !shouldRenderLayerToAtlas(layer) ){
            continue;
        }
        s += '    ';
        s += '<SubTexture ';
        s += 'name="' + layer.name + '" ';
        s += 'x="' + layer.packedOrigin.x + '" ';
        s += 'y="' + layer.packedOrigin.y + '" ';
        s += 'width="' + layer.width + '" ';
        s += 'height="' + layer.height + '" ';
        s += 'pivotX="' + -layer.left + '" ';
        s += 'pivotY="' + -layer.top + '" ';
        s += 'layer="' + layer.layer_index + '" ';
        s += '/>';
        s += '\n';
    }
    
    // close TextureAtlas node
    s += '</TextureAtlas>';
    s += '\n';
    
    return s;
}

function saveFile( path, content ){
    var fileObj = new File( path );
    if( fileObj.open( 'w' ) ){
        fileObj.write( content );
        fileObj.close();
    } else {
        alert( "Could not create file: " + path );
    }
}

function processLayers(){
    
    // set to pixels, storing original ruler setting so we can return to it
    startRulerUnits = app.preferences.rulerUnits
    app.preferences.rulerUnits = Units.PIXELS

	var docRef = app.activeDocument;
	
	// store the layer visibility going in so we can return to it
	// and hide everything
	var origVis = [];
	for( var i = 0; i < docRef.layers.length; i++ ){
		origVis.push( docRef.layers[i].visible );
		docRef.layers[i].visible = false;
	}
	
	// show each "top level" layer, export a trimmed version
	var metadata = documentMetadata( docRef );
	metadata.layers = [];
	for( var i = 0; i < docRef.layers.length; i++ ){				
		var bounds = docRef.layers[i].bounds;
		var part_name;
		switch( docRef.layers[i].name.substr(0,1) ){
			case ".":
				// ignore
				break;
			default:
				metadata.layers.push( layerMetadata( docRef, i ) );
		}
	}
	
	buildAtlas( metadata );
	
	renderAtlas( docRef, metadata );
	
	if( metadata.layers.length > 0 ){
		//saveFile( outputFolder + "/" + getMetadataName(metadata) + ".json", json( metadata ) );
		saveFile( outputFolder + "/" + getMetadataName(metadata) + ".xml", starlingXml( metadata ) );
	}
	
	app.activeDocument = docRef;
	for( var i = 0; i < docRef.layers.length; i++ ){
		docRef.layers[i].visible = origVis[i];
	}
	
	docRef = null;    

    // restore ruler settings
    app.preferences.rulerUnits = startRulerUnits
}