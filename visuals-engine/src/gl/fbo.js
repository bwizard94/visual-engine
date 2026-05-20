/**
 * Creates a framebuffer object backed by a RGBA/UNSIGNED_BYTE texture.
 *
 * LINEAR filtering is used so the feedback scale/rotation transform samples
 * smoothly between texels. CLAMP_TO_EDGE prevents wrap-around bleeding at
 * screen edges when the feedback UV transform goes slightly out of [0,1].
 *
 * @param {WebGLRenderingContext} gl
 * @param {number} width
 * @param {number} height
 * @returns {{ fbo: WebGLFramebuffer, texture: WebGLTexture, width: number, height: number }}
 */
export function createFBO(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

/**
 * Destroys an FBO and its backing texture.
 *
 * @param {WebGLRenderingContext} gl
 * @param {{ fbo: WebGLFramebuffer, texture: WebGLTexture }} fboObj
 */
export function destroyFBO(gl, fboObj) {
  gl.deleteFramebuffer(fboObj.fbo);
  gl.deleteTexture(fboObj.texture);
}
