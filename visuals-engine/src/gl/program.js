/**
 * Compiles a GLSL shader. Throws on error with source line context.
 */
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${info}`);
  }
  return shader;
}

/**
 * Links a WebGL program from vert/frag source strings.
 * Returns { program, uniforms, attributes } with all locations pre-cached.
 */
export function createProgram(gl, vertSrc, fragSrc, uniformNames, attributeNames) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${info}`);
  }

  gl.deleteShader(vert);
  gl.deleteShader(frag);

  // Cache all locations up front — avoids per-frame getUniformLocation calls
  const uniforms = {};
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  const attributes = {};
  for (const name of attributeNames) {
    attributes[name] = gl.getAttribLocation(program, name);
  }

  return { program, uniforms, attributes };
}
