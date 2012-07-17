goog.provide('ol.webgl.Map');
goog.provide('ol.webgl.map.shader');

goog.require('goog.dispose');
goog.require('goog.dom');
goog.require('goog.dom.TagName');
goog.require('goog.events');
goog.require('goog.events.Event');
goog.require('goog.events.EventType');
goog.require('goog.style');
goog.require('goog.webgl');
goog.require('ol.Layer');
goog.require('ol.Map');
goog.require('ol.TileLayer');
goog.require('ol.webgl.TileLayerRenderer');
goog.require('ol.webgl.WebGLContextEventType');
goog.require('ol.webgl.shader.Fragment');
goog.require('ol.webgl.shader.Vertex');


/**
 * @define {boolean} Enable WebGL debugging.
 */
ol.DEBUG_WEBGL = false;



/**
 * @constructor
 * @extends {ol.webgl.shader.Fragment}
 */
ol.webgl.map.shader.Fragment = function() {
  goog.base(this, [
    'precision mediump float;',
    '',
    'uniform float uAlpha;',
    'uniform sampler2D uTexture;',
    '',
    'varying vec2 vTexCoord;',
    '',
    'void main(void) {',
    '  gl_FragColor = vec4(texture2D(uTexture, vTexCoord).rgb, uAlpha);',
    '}'
  ].join('\n'));
};
goog.inherits(ol.webgl.map.shader.Fragment, ol.webgl.shader.Fragment);
goog.addSingletonGetter(ol.webgl.map.shader.Fragment);



/**
 * @constructor
 * @extends {ol.webgl.shader.Vertex}
 */
ol.webgl.map.shader.Vertex = function() {
  goog.base(this, [
    'attribute vec2 aPosition;',
    'attribute vec2 aTexCoord;',
    '',
    'varying vec2 vTexCoord;',
    '',
    'void main(void) {',
    '  gl_Position = vec4(aPosition, 0., 1.);',
    '  vTexCoord = aTexCoord;',
    '}'
  ].join('\n'));
};
goog.inherits(ol.webgl.map.shader.Vertex, ol.webgl.shader.Vertex);
goog.addSingletonGetter(ol.webgl.map.shader.Vertex);



/**
 * @constructor
 * @extends {ol.Map}
 * @param {!HTMLDivElement} target Target.
 * @param {Object.<string, *>=} opt_values Values.
 */
ol.webgl.Map = function(target, opt_values) {

  goog.base(this, target);

  /**
   * @private
   * @type {Element}
   */
  this.canvas_ = goog.dom.createElement(goog.dom.TagName.CANVAS);
  this.canvas_.height = target.clientHeight;
  this.canvas_.width = target.clientWidth;
  this.canvas_.style.overflow = 'hidden';
  target.appendChild(this.canvas_);

  /**
   * @private
   * @type {WebGLRenderingContext}
   */
  this.gl_ = this.canvas_.getContext('experimental-webgl', {
    alpha: false,
    antialias: true,
    depth: false,
    preserveDrawingBuffer: false,
    stencil: false
  });
  goog.asserts.assert(!goog.isNull(this.gl_));

  if (ol.DEBUG_WEBGL) {
    this.gl_ = WebGLDebugUtils.makeDebugContext(this.gl_);
  }

  goog.events.listen(this.canvas_, ol.webgl.WebGLContextEventType.LOST,
      this.handleWebGLContextLost, false, this);
  goog.events.listen(this.canvas_, ol.webgl.WebGLContextEventType.RESTORED,
      this.handleWebGLContextRestored, false, this);

  /**
   * @private
   * @type {Object.<number, WebGLShader>}
   */
  this.shaderCache_ = {};

  /**
   * @private
   * @type {Object.<string, WebGLProgram>}
   */
  this.programCache_ = {};

  /**
   * @private
   * @type {Object.<string, WebGLTexture>}
   */
  this.textureCache_ = {};

  /**
   * @private
   * @type {ol.webgl.shader.Fragment}
   */
  this.fragmentShader_ = ol.webgl.map.shader.Fragment.getInstance();

  /**
   * @private
   * @type {ol.webgl.shader.Vertex}
   */
  this.vertexShader_ = ol.webgl.map.shader.Vertex.getInstance();

  /**
   * @private
   * @type {Object.<number, null|number>}
   */
  this.layerRendererChangeListenKeys_ = {};

  if (goog.isDef(opt_values)) {
    this.setValues(opt_values);
  }

  this.handleViewportResize();
  this.handleWebGLContextRestored();

};
goog.inherits(ol.webgl.Map, ol.Map);


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.createLayerRenderer = function(layer) {
  var gl = this.getGL();
  if (layer instanceof ol.TileLayer) {
    return new ol.webgl.TileLayerRenderer(this, layer);
  } else {
    goog.asserts.assert(false);
    return null;
  }
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.disposeInternal = function() {
  var gl = this.getGL();
  if (!gl.isContextLost()) {
    goog.object.forEach(this.programCache_, function(program) {
      gl.deleteProgram(program);
    });
    goog.object.forEach(this.shaderCache_, function(shader) {
      gl.deleteShader(shader);
    });
    goog.object.forEach(this.textureCache_, function(texture) {
      gl.deleteTexture(texture);
    });
  }
  goog.base(this, 'disposeInternal');
};


/**
 * @return {WebGLRenderingContext} GL.
 */
ol.webgl.Map.prototype.getGL = function() {
  return this.gl_;
};


/**
 * @param {ol.webgl.shader.Fragment} fragmentShaderObject Fragment shader.
 * @param {ol.webgl.shader.Vertex} vertexShaderObject Vertex shader.
 * @return {WebGLProgram} Program.
 */
ol.webgl.Map.prototype.getProgram = function(
    fragmentShaderObject, vertexShaderObject) {
  var key =
      goog.getUid(fragmentShaderObject) + '/' + goog.getUid(vertexShaderObject);
  if (key in this.programCache_) {
    return this.programCache_[key];
  } else {
    var gl = this.getGL();
    var program = gl.createProgram();
    gl.attachShader(program, this.getShader(fragmentShaderObject));
    gl.attachShader(program, this.getShader(vertexShaderObject));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, goog.webgl.LINK_STATUS) &&
        !gl.isContextLost()) {
      window.console.log(gl.getProgramInfoLog(program));
      goog.asserts.assert(
          gl.getProgramParameter(program, goog.webgl.LINK_STATUS));
    }
    this.programCache_[key] = program;
    return program;
  }
};


/**
 * @param {ol.webgl.Shader} shaderObject Shader object.
 * @return {WebGLShader} Shader.
 */
ol.webgl.Map.prototype.getShader = function(shaderObject) {
  var key = goog.getUid(shaderObject);
  if (key in this.shaderCache_) {
    return this.shaderCache_[key];
  } else {
    var gl = this.getGL();
    var shader = gl.createShader(shaderObject.getType());
    gl.shaderSource(shader, shaderObject.getSource());
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, goog.webgl.COMPILE_STATUS) &&
        !gl.isContextLost()) {
      window.console.log(gl.getShaderInfoLog(shader));
      goog.asserts.assert(
          gl.getShaderParameter(shader, goog.webgl.COMPILE_STATUS));
    }
    this.shaderCache_[key] = shader;
    return shader;
  }
};


/**
 * @param {Image} image Image.
 * @return {WebGLTexture} Texture.
 */
ol.webgl.Map.prototype.getTexture = function(image) {
  if (image.src in this.textureCache_) {
    return this.textureCache_[image.src];
  } else {
    var gl = this.getGL();
    var texture = gl.createTexture();
    gl.bindTexture(goog.webgl.TEXTURE_2D, texture);
    gl.texImage2D(goog.webgl.TEXTURE_2D, 0, goog.webgl.RGBA, goog.webgl.RGBA,
        goog.webgl.UNSIGNED_BYTE, image);
    gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MAG_FILTER,
        goog.webgl.LINEAR);
    gl.texParameteri(goog.webgl.TEXTURE_2D, goog.webgl.TEXTURE_MIN_FILTER,
        goog.webgl.LINEAR);
    this.textureCache_[image.src] = texture;
    return texture;
  }
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.handleCenterChanged = function() {
  goog.base(this, 'handleCenterChanged');
  this.redraw();
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.handleLayerAdd = function(layer) {
  goog.base(this, 'handleLayerAdd', layer);
  if (layer.getVisible()) {
    this.redraw();
  }
};


/**
 * @param {goog.events.Event} event Event.
 * @protected
 */
ol.webgl.Map.prototype.handleLayerRendererChange = function(event) {
  var layerRenderer = /** @type {ol.LayerRenderer} */ (event.target);
  if (layerRenderer.getLayer().getVisible()) {
    this.redraw();
  }
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.handleLayerRemove = function(layer) {
  goog.base(this, 'handleLayerRemove', layer);
  if (layer.getVisible()) {
    this.redraw();
  }
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.handleResolutionChanged = function() {
  goog.base(this, 'handleResolutionChanged');
  this.redraw();
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.handleSizeChanged = function() {
  goog.base(this, 'handleSizeChanged');
  var size = this.getSize();
  if (!goog.isDef(size)) {
    return;
  }
  this.canvas_.width = size.width;
  this.canvas_.height = size.height;
  var gl = this.gl_;
  if (!goog.isNull(gl)) {
    gl.viewport(0, 0, size.width, size.height);
    this.redraw();
  }
};


/**
 * @param {goog.events.Event} event Event.
 * @protected
 */
ol.webgl.Map.prototype.handleWebGLContextLost = function(event) {
  event.preventDefault();
  this.shaderCache_ = {};
  this.programCache_ = {};
  this.textureCache_ = {};
  goog.object.forEach(this.layerRenderers, function(layerRenderer) {
    layerRenderer.handleWebGLContextLost();
  });
};


/**
 * @protected
 */
ol.webgl.Map.prototype.handleWebGLContextRestored = function() {
  var gl = this.gl_;
  gl.clearColor(1, 0, 0, 1);
  gl.disable(goog.webgl.CULL_FACE);
  gl.disable(goog.webgl.SCISSOR_TEST);
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.redrawInternal = function() {

  var animate = goog.base(this, 'redrawInternal');

  var gl = this.getGL();

  this.forEachVisibleLayer(function(layer, layerRenderer) {
    if (layerRenderer.redraw()) {
      animate = true;
    }
  });

  gl.clear(goog.webgl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(goog.webgl.FRAMEBUFFER, null);
  gl.useProgram(this.getProgram(this.fragmentShader_, this.vertexShader_));
  this.forEachVisibleLayer(function(layer, layerRenderer) {
    gl.bindTexture(goog.webgl.TEXTURE_2D, layerRenderer.getTexture());
  }, this);

  return animate;

};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.removeLayerRenderer = function(layer) {
  var layerRenderer = goog.base(this, 'removeLayerRenderer', layer);
  if (!goog.isNull(layerRenderer)) {
    var key = goog.getUid(layer);
    goog.events.unlistenByKey(this.layerRendererChangeListenKeys_[key]);
    delete this.layerRendererChangeListenKeys_[key];
  }
  return layerRenderer;
};


/**
 * @inheritDoc
 */
ol.webgl.Map.prototype.setLayerRenderer = function(layer, layerRenderer) {
  goog.base(this, 'setLayerRenderer', layer, layerRenderer);
  var key = goog.getUid(layer);
  this.layerRendererChangeListenKeys_[key] = goog.events.listen(layerRenderer,
      goog.events.EventType.CHANGE, this.handleLayerRendererChange, false,
      this);
};
