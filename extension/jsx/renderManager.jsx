/*jslint vars: true , plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global bm_layerElement, bm_eventDispatcher, bm_sourceHelper, bm_generalUtils, bm_compsManager, bm_downloadManager, bm_textShapeHelper, app, File*/
var bm_renderManager = (function () {
    'use strict';
    
    var ob = {}, pendingLayers = [], pendingComps = [], destinationPath, currentCompID, totalLayers, currentLayer;
    var standalone = false;
    
    function verifyTrackLayer(layerData, comp, pos) {
        var nextLayerInfo = comp.layers[pos + 2];
        if (nextLayerInfo.isTrackMatte) {
            layerData.td = 0;
        }
    }
    
    function restoreParents(layers) {
        
        var layerData, parentData, i, len = layers.length, hasChangedState = false;
        for (i = 0; i < len; i += 1) {
            layerData = layers[i];
            if (layerData.parent !== undefined) {
                parentData = layers[layerData.parent];
                if (parentData.render === false) {
                    parentData.ty = bm_layerElement.layerTypes.nullLayer;
                    hasChangedState = true;
                    parentData.render = true;
                    if (!parentData.isValid) {
                        parentData.isValid = true;
                    }
                }
            }
        }
        if (hasChangedState) {
            restoreParents(layers);
        }
    }
    
    function createLayers(comp, layers, framerate) {
        var i, len = comp.layers.length, layerInfo, layerData, prevLayerData;
        for (i = 0; i < len; i += 1) {
            layerInfo = comp.layers[i + 1];
            layerData = bm_layerElement.prepareLayer(layerInfo, i);
            if (layerData.td && prevLayerData && prevLayerData.td) {
                prevLayerData.td = false;
                if (prevLayerData.enabled === false) {
                    prevLayerData.render = false;
                }
            } else if (layerData.tt) {
                if (layerData.render === false) {
                    if (prevLayerData.enabled === false) {
                        prevLayerData.render = false;
                    }
                    prevLayerData.td = false;
                } else if (prevLayerData.render === false) {
                    layerData.tt = false;
                }
            }
            layers.push(layerData);
            pendingLayers.push({data: layerData, layer: layerInfo, framerate: framerate});
            prevLayerData = layerData;
        }
        restoreParents(layers);
        for (i = 0; i < len; i += 1) {
            layerData = layers[i];
            layerInfo = comp.layers[i + 1];
            bm_layerElement.checkLayerSource(layerInfo, layerData);
            if (layerData.ty === bm_layerElement.layerTypes.precomp && layerData.render !== false && layerData.compId) {
                layerData.layers = [];
                createLayers(layerInfo.source, layerData.layers, framerate);
            }
        }
    }
    
    function render(comp, destination, sAlone) {
        currentCompID = comp.id;
        standalone = sAlone;
        bm_eventDispatcher.sendEvent('bm:render:update', {type: 'update', message: 'Starting Render', compId: currentCompID, progress: 0});
        destinationPath = destination;
        bm_sourceHelper.reset();
        bm_textShapeHelper.reset();
        pendingLayers.length = 0;
        pendingComps.length = 0;
        var exportData = ob.renderData.exportData;
        exportData.animation = {};
        exportData.assets = [];
        exportData.fonts = [];
        exportData.v = '2.1.2';
        exportData.animation.layers = [];
        exportData.animation.totalFrames = comp.workAreaDuration * comp.frameRate;
        exportData.animation.frameRate = comp.frameRate;
        exportData.animation.ff = comp.workAreaStart;
        exportData.animation.compWidth = comp.width;
        exportData.animation.compHeight = comp.height;
        ob.renderData.firstFrame = exportData.animation.ff * comp.frameRate;
        createLayers(comp, exportData.animation.layers, exportData.animation.frameRate);
        totalLayers = pendingLayers.length;
        currentLayer = 0;
        app.scheduleTask('bm_renderManager.renderNextLayer();', 20, false);
    }
    
    function saveData() {
        bm_eventDispatcher.sendEvent('bm:render:update', {type: 'update', message: 'Saving data ', compId: currentCompID, progress: 1});
        var dataFile = new File(destinationPath);
        dataFile.open('w', 'TEXT', '????');
        if (ob.renderData.exportData.assets.length === 0) {
            delete ob.renderData.exportData.assets;
        }
        if (ob.renderData.exportData.fonts.length === 0) {
            delete ob.renderData.exportData.fonts;
        }
        var string = JSON.stringify(ob.renderData.exportData);
        string = string.replace(/\n/g, '');
        if (standalone) {
            var bodymovinJsStr = bm_downloadManager.getStandaloneData();
            string = bodymovinJsStr.replace('"__[ANIMATIONDATA]__"', "'" + string + "'");
            string = string.replace('"__[STANDALONE]__"', 'true');
        }
        //__[STANDALONE]__
        try {
            dataFile.write(string); //DO NOT ERASE, JSON UNFORMATTED
            //dataFile.write(JSON.stringify(ob.renderData.exportData, null, '  ')); //DO NOT ERASE, JSON FORMATTED
            dataFile.close();
        } catch (err) {
            bm_eventDispatcher.sendEvent('bm:alert', {message: 'Could not write file.<br /> Make sure you have enabled scripts to write files. <br /> Edit > Preferences > General > Allow Scripts to Write Files and Access Network '});
        }
        bm_eventDispatcher.sendEvent('bm:render:update', {type: 'update', message: 'Render finished ', compId: currentCompID, progress: 1, isFinished: true});
        bm_compsManager.renderComplete();
    }
    
    function clearUnrenderedLayers(layers) {
        var i, len = layers.length;
        for (i = 0; i < len; i += 1) {
            if (layers[i].render === false) {
                layers.splice(i, 1);
                i -= 1;
                len -= 1;
            } else if (layers[i].ty === bm_layerElement.layerTypes.precomp && layers[i].layers) {
                clearUnrenderedLayers(layers[i].layers);
            }
        }
    }
    
    function removeExtraData() {
        clearUnrenderedLayers(ob.renderData.exportData.animation.layers);
    }
    
    function renderNextLayer() {
        if (bm_compsManager.cancelled) {
            return;
        }
        if (pendingLayers.length) {
            var nextLayerData = pendingLayers.pop();
            currentLayer += 1;
            bm_eventDispatcher.sendEvent('bm:render:update', {type: 'update', message: 'Rendering layer: ' + nextLayerData.layer.name, compId: currentCompID, progress: currentLayer / totalLayers});
            bm_layerElement.renderLayer(nextLayerData);
        } else {
            removeExtraData();
            bm_sourceHelper.exportImages(destinationPath, ob.renderData.exportData.assets, currentCompID);
        }
    }
    
    function checkFonts() {
        var fonts = bm_sourceHelper.getFonts();
        if (fonts.length === 0) {
            saveData();
        } else {
            var exportData = ob.renderData.exportData;
            bm_eventDispatcher.sendEvent('bm:render:fonts', {type: 'save', compId: currentCompID, fonts: fonts});
        }
    }
    
    function setChars(chars) {
        bm_eventDispatcher.sendEvent('bm:render:chars', {type: 'save', compId: currentCompID, chars: chars});
    }
    
    function setFontData(fontData) {
        var exportData = ob.renderData.exportData;
        exportData.fonts = fontData;
        bm_textShapeHelper.exportChars(fontData);
    }
    
    function setCharsData(charData) {
        var exportData = ob.renderData.exportData;
        exportData.chars = charData;
        saveData();
    }
    
    function imagesReady() {
        checkFonts();
    }
    
    function renderLayerComplete() {
        app.scheduleTask('bm_renderManager.renderNextLayer();', 20, false);
    }
    
    ob.renderData = {
        exportData : {
            animation : {},
            assets : []
        }
    };
    ob.render = render;
    ob.renderLayerComplete = renderLayerComplete;
    ob.renderNextLayer = renderNextLayer;
    ob.setChars = setChars;
    ob.imagesReady = imagesReady;
    ob.setFontData = setFontData;
    ob.setCharsData = setCharsData;
    
    return ob;
}());