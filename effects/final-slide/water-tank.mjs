/**
 * Perspective aquarium: analytic room geometry and a refractive 3D water surface.
 * No libraries, images, network requests, animation loop, or document styling.
 * render({time: seconds, progress: 0..1, intensity: 1, reveal: 0..1});
 * reveal=0 clears the canvas. Four bounded surface refinements; 1.2M pixel cap.
 */
export class WaterTank {
  constructor(canvas) {
    this.canvas=canvas;
    this.width=this.height=1;
    this.dpr=1;
    this.disposed=false;
    this.lost=false;
    this.ready=false;
    this.particleData=new Float32Array(88*7);
    this.resources=[];
    try {
      this.gl=canvas.getContext('webgl', {alpha:true, antialias:false, depth:false,
        stencil:false, premultipliedAlpha:false, preserveDrawingBuffer:true, powerPreference:'high-performance'});
    } catch { this.gl=null; }
    if (!this.gl) {this.fallback=new ProjectedWater(canvas);canvas.dataset.renderer='canvas-fallback';}
    else if(needsDriverFallback(this.gl))this.useFallback('driver-compatibility');
    else {
      this.onLost=event=>{
        event.preventDefault();this.lost=true;this.ready=false;
        this.canvas.dataset.renderer='webgl-lost';
        console.warn('WaterTank WebGL context lost; switching to projected Canvas.');
        this.useFallback('context-lost');
      };
      this.onRestored=()=>{if(!this.disposed){this.lost=false;this.initialize();this.resize();}};
      canvas.addEventListener('webglcontextlost',this.onLost);
      canvas.addEventListener('webglcontextrestored',this.onRestored);
      this.initialize();
    }
    this.resize();
  }
  initialize() {
    const gl=this.gl;
    this.resources=[];
    try {
      this.scene=this.program(VERTEX,FRAGMENT);
      this.particles=this.program(PARTICLE_VERTEX,PARTICLE_FRAGMENT);
      this.quad=gl.createBuffer();
      this.particleBuffer=gl.createBuffer();
      this.resources.push(['buffer',this.quad],['buffer',this.particleBuffer]);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      this.sceneLocations=locations(gl,this.scene,['uResolution','uTime','uProgress','uIntensity','uReveal']);
      this.particleLocations=locations(gl,this.particles,['uResolution','uReveal']);
      this.scenePosition=gl.getAttribLocation(this.scene,'aPosition');
      this.particlePosition=gl.getAttribLocation(this.particles,'aPosition');
      this.particleInfo=gl.getAttribLocation(this.particles,'aInfo');
      this.ready=true;this.checkedDrawing=false;this.error=null;this.canvas.dataset.renderer='webgl';
    } catch(error) {
      // A rejected shader must not interfere with Proceed, Skip, or replay.
      this.ready=false;
      this.error=error instanceof Error?error.message:String(error);
      this.canvas.dataset.renderer='webgl-error';
      console.warn('WaterTank WebGL initialization failed:',this.error);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.useFallback('shader-error');
    }
  }
  useFallback(reason) {
    if(this.disposed||this.fallback)return;
    const previous=this.canvas;
    previous.removeEventListener('webglcontextlost',this.onLost);
    previous.removeEventListener('webglcontextrestored',this.onRestored);
    // A canvas cannot switch context families. Preserve its DOM contract while
    // replacing the unusable drawing surface with a fresh 2D canvas.
    const replacement=previous.cloneNode(false);
    replacement.dataset.renderer='canvas-fallback';
    replacement.dataset.rendererReason=reason;
    previous.replaceWith(replacement);
    if(this.gl&&!this.lost){
      for(const[type,item]of this.resources)type==='buffer'?this.gl.deleteBuffer(item):this.gl.deleteProgram(item);
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.resources=[];this.gl=null;this.ready=false;this.canvas=replacement;
    this.fallback=new ProjectedWater(replacement);
    if(this.latestFrame)this.fallback.render(this.latestFrame);
  }
  program(vertexSource,fragmentSource) {
    const gl=this.gl, program=gl.createProgram();
    for(const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
      const shader=gl.createShader(type);
      gl.shaderSource(shader,source); gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
        const message=gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);gl.deleteProgram(program);
        throw new Error(message||'Water shader compilation failed.');
      }
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) {
      const message=gl.getProgramInfoLog(program);gl.deleteProgram(program);
      throw new Error(message||'Water shader linking failed.');
    }
    this.resources.push(['program',program]);return program;
  }
  resize() {
    if(this.disposed)return;
    if(this.fallback)return this.fallback.resize();
    const rect=this.canvas.getBoundingClientRect();
    // A hidden canvas must not replace a useful buffer with a 1px buffer.
    if(rect.width<1||rect.height<1)return;
    this.width=rect.width;this.height=rect.height;
    this.dpr=Math.min(2,globalThis.devicePixelRatio||1,Math.sqrt(1200000/(rect.width*rect.height)));
    const width=Math.max(1,Math.round(rect.width*this.dpr)),height=Math.max(1,Math.round(rect.height*this.dpr));
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    if(this.gl&&!this.lost)this.gl.viewport(0,0,width,height);
  }
  render({time=0,progress=0,intensity=1,reveal=progress>0?1:0}={}) {
    if(this.disposed)return;
    const p=clamp(finite(progress),0,1),strength=clamp(finite(intensity,1),0,1.5);
    const visibility=clamp(finite(reveal),0,1),t=finite(time);
    this.latestFrame={time:t,progress:p,intensity:strength,reveal:visibility};
    if(this.fallback)return this.fallback.render({time:t,progress:p,intensity:strength,reveal:visibility});
    if(this.lost||!this.ready)return;
    const gl=this.gl;
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    if(visibility<0.001)return;
    gl.disable(gl.BLEND);gl.useProgram(this.scene);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.enableVertexAttribArray(this.scenePosition);gl.vertexAttribPointer(this.scenePosition,2,gl.FLOAT,false,0,0);
    const u=this.sceneLocations;
    gl.uniform2f(u.uResolution,this.canvas.width,this.canvas.height);
    gl.uniform1f(u.uTime,t);gl.uniform1f(u.uProgress,p);gl.uniform1f(u.uIntensity,strength);gl.uniform1f(u.uReveal,visibility);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.disableVertexAttribArray(this.scenePosition);
    if(!this.checkedDrawing&&visibility>0.5){
      this.checkedDrawing=true;
      const pixel=new Uint8Array(4);
      gl.readPixels(Math.floor(this.canvas.width/2),Math.floor(this.canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      const error=gl.getError();
      // The center ray always hits the opaque aquarium interior. A transparent
      // center detects drivers that accept shaders but never produce pixels.
      if(error!==gl.NO_ERROR||pixel[3]===0){
        console.warn('WaterTank WebGL drawing check failed; switching to projected Canvas.',{error,alpha:pixel[3]});
        this.useFallback('empty-webgl-frame');return;
      }
      this.canvas.dataset.rendererVerified='true';
    }
    this.drawParticles(t,p,strength,visibility);
  }
  drawParticles(time,progress,intensity,reveal) {
    if(progress<0.025)return;
    const halfX=5*this.width/this.height,level=waterLevel(progress),front=surge(progress);
    let count=0;
    const add=(x,y,z,radius,type,alpha,stretch=1)=>{
      this.particleData.set([x,y,z,radius,type,alpha,stretch],count++*7);
    };
    for(let i=0;i<60;i++) {
      const life=fract(random(i*9+9)+time*(0.034+random(i+90)*0.019));
      const x=(random(i*9+1)*2-1)*halfX*0.95+Math.sin(time*0.7+i)*0.09;
      const y=-4.6+life*11.3,z=-8+random(i*9+3)*(8+front);
      if(y>waveHeight(x,z,time,progress,intensity)-0.22)continue;
      add(x,y,z,0.015+random(i*9+4)**2*0.047,0,clamp((level-y)*2,0,1)*0.26);
    }
    const activity=Math.sin(Math.PI*progress)*smooth(0.12,0.3,progress)*intensity;
    if(activity>0.025)for(let i=0;i<24;i++) {
      const age=fract(time*(0.65+random(i+212)*0.18)+random(i+334));
      const x=(random(i+199)*2-1)*halfX*0.95+(random(i+89)-0.5)*age*1.4;
      const z=front+0.12+age*(1.1+random(i+435)*1.9);
      const y=waveHeight(x,front,time-age*0.7,progress,intensity)
        +(age*(2.7+random(i+289)*2.8)-age*age*6)*activity;
      if(y<waveHeight(x,z,time,progress,intensity)-0.13)continue;
      add(x,y,z,0.024+random(i+187)**2*0.065,1,activity*Math.sin(age*Math.PI)*0.88,1+Math.abs(0.5-age)*0.8);
    }
    if(!count)return;
    const gl=this.gl;gl.useProgram(this.particles);gl.bindBuffer(gl.ARRAY_BUFFER,this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,this.particleData.subarray(0,count*7),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.particlePosition);gl.enableVertexAttribArray(this.particleInfo);
    gl.vertexAttribPointer(this.particlePosition,3,gl.FLOAT,false,28,0);
    gl.vertexAttribPointer(this.particleInfo,4,gl.FLOAT,false,28,12);
    gl.uniform2f(this.particleLocations.uResolution,this.canvas.width,this.canvas.height);
    gl.uniform1f(this.particleLocations.uReveal,reveal);
    gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS,0,count);
    gl.disableVertexAttribArray(this.particlePosition);gl.disableVertexAttribArray(this.particleInfo);gl.disable(gl.BLEND);
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    this.canvas.removeEventListener('webglcontextlost',this.onLost);
    this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
    this.fallback?.dispose();
    if(this.gl&&!this.lost&&!this.gl.isContextLost()) {
      for(const[type,item]of this.resources)type==='buffer'?this.gl.deleteBuffer(item):this.gl.deleteProgram(item);
      this.gl.clearColor(0,0,0,0);this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      // The finale owns this context. Hiding its canvas alone retains the GPU
      // allocation while the embedded lab resumes. Replay uses a fresh canvas.
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    // Release the drawing buffer even when context loss happened before its
    // event, the extension is unavailable, or the 2D fallback was being used.
    this.canvas.width=this.canvas.height=1;
    this.resources=[];this.particleData=this.latestFrame=null;
    this.gl=this.fallback=null;this.ready=false;
    this.scene=this.particles=this.quad=this.particleBuffer=null;
    this.sceneLocations=this.particleLocations=null;
    this.onLost=this.onRestored=null;
  }
}

function needsDriverFallback(gl) {
  // Confirmed on Chrome/ANGLE: this driver's first water draw fails dynamic
  // pixel-shader compilation and loses every WebGL context, including the lab.
  // Select the existing Canvas renderer before compiling any finale shaders.
  try {
    const info=gl.getExtension('WEBGL_debug_renderer_info');
    if(!info)return false;
    const renderer=gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return typeof renderer==='string'&&/NVIDIA/i.test(renderer)&&
      /GeForce\s+GT\s*730\b/i.test(renderer)&&/Direct3D11|D3D11/i.test(renderer);
  } catch {return false;}
}

const VERTEX=`
attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.0,1.0);}
`;
const FRAGMENT=`
precision highp float;
uniform vec2 uResolution;
uniform float uTime,uProgress,uIntensity,uReveal;
const float FAR=10000.0;
const vec3 CAMERA=vec3(0.0,3.2,11.5);
float halfX,level,amplitude,frontZ;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
// Displaced surface height and exact x/z derivatives.
vec3 water(vec2 q){
  float a=q.x*0.48+q.y*0.62-uTime*1.45;
  float b=q.x*1.10-q.y*0.88-uTime*1.95+1.3;
  float c=q.x*2.35+q.y*1.90-uTime*2.5;
  float d=q.x*4.50-q.y*3.60-uTime*3.2;
  float center=mix(-7.0,4.0,smoothstep(0.1,0.88,uProgress));
  float dz=q.y-center,packet=exp(-dz*dz*0.34);
  float across=0.78+0.22*sin(q.x*0.70-uTime*0.7);
  float slope=sin(uProgress*3.14159265)*0.022;
  float h=0.48*sin(a)+0.24*sin(b)+0.095*sin(c)+0.025*sin(d)+packet*across*0.8;
  float dx=0.2304*cos(a)+0.264*cos(b)+0.22325*cos(c)+0.1125*cos(d)+packet*0.1232*cos(q.x*0.7-uTime*0.7);
  float dzd=0.2976*cos(a)-0.2112*cos(b)+0.1805*cos(c)-0.09*cos(d)-packet*dz*0.544*across;
  return vec3(level+amplitude*h-q.x*slope,amplitude*dx-slope,amplitude*dzd);
}
bool roomBounds(vec3 p){return abs(p.x)<halfX+0.01&&p.y>-4.76&&p.y<5.01&&p.z>-8.51&&p.z<0.02;}
// The five interior planes leave the front open to a protruding water surge.
float roomHit(vec3 ro,vec3 rd,out vec3 normal,out float material){
  float best=FAR,t;vec3 p;normal=vec3(0,0,1);material=2.0;
  if(abs(rd.y)>0.0001){
    t=((rd.y<0.0?-4.75:5.0)-ro.y)/rd.y;p=ro+rd*t;
    if(t>0.015&&t<best&&roomBounds(p)){best=t;normal=vec3(0,-sign(rd.y),0);material=rd.y<0.0?0.0:3.0;}
  }
  if(abs(rd.x)>0.0001){
    t=((rd.x<0.0?-halfX:halfX)-ro.x)/rd.x;p=ro+rd*t;
    if(t>0.015&&t<best&&roomBounds(p)){best=t;normal=vec3(-sign(rd.x),0,0);material=1.0;}
  }
  if(rd.z<-0.0001){
    t=(-8.5-ro.z)/rd.z;p=ro+rd*t;
    if(t>0.015&&t<best&&roomBounds(p)){best=t;normal=vec3(0,0,1);material=2.0;}
  }
  return best;
}
float grid(vec2 q){vec2 f=abs(fract(q+0.5)-0.5);return 1.0-smoothstep(0.007,0.020,min(f.x,f.y));}
float caustic(vec2 p){
  p*=1.7;p+=vec2(sin(p.y*1.12+uTime*0.32),cos(p.x*0.85-uTime*0.27))*0.75;
  float a=abs(sin(p.x+p.y*0.42+sin(p.y*1.35+uTime*0.26)));
  float b=abs(sin(p.y-p.x*0.26+sin(p.x*1.17-uTime*0.3)));
  return pow(1.0-min(a,b),12.0);
}
vec3 roomColor(vec3 p,vec3 normal,float material){
  vec3 color;
  if(material<0.5){
    float tile=mod(floor(p.x*0.8)+floor(p.z*0.8),2.0);
    color=mix(vec3(0.065,0.105,0.135),vec3(0.088,0.14,0.168),tile);
    color+=vec3(0.09,0.16,0.18)*grid(p.xz*0.8);
    float pool=1.0-smoothstep(level-0.1,level+0.2,p.y);
    color+=vec3(0.05,0.27,0.30)*caustic(p.xz)*pool;
  }else{
    vec2 uv=material<1.5?p.zy:p.xy;
    color=material<1.5?vec3(0.034,0.070,0.091):vec3(0.051,0.092,0.117);
    color+=vec3(0.021,0.031,0.034)*grid(uv*vec2(0.32,0.42));
    color+=vec3(0.06,0.34,0.40)*exp(-abs(p.y+4.55)*12.0);
    float underwater=1.0-smoothstep(level-0.12,level+0.12,p.y);
    color+=vec3(0.02,0.12,0.16)*caustic(uv*0.8)*underwater;
    color+=vec3(0.025,0.09,0.11)*exp(-abs(p.y-4.6)*22.0);
  }
  float corner;
  if(material<0.5)corner=min(halfX-abs(p.x),p.z+8.5);
  else if(material>1.5)corner=min(halfX-abs(p.x),p.y+4.75);
  else corner=min(p.z+8.5,p.y+4.75);
  color*=0.58+0.42*smoothstep(0.0,1.0,corner);
  color*=0.75+0.25*max(dot(normal,normalize(vec3(-0.35,0.8,0.4))),0.0);
  return color;
}
vec3 environment(vec3 direction){
  vec3 color=mix(vec3(0.012,0.045,0.075),vec3(0.16,0.38,0.43),smoothstep(-0.05,0.8,direction.y));
  vec3 light=normalize(vec3(-0.38,0.86,0.2));
  color+=vec3(0.67,0.98,1.0)*pow(max(dot(direction,light),0.0),35.0);
  vec2 panelOffset=vec2((direction.x+0.30)/0.19,(direction.y-0.6)/0.055);
  float panel=exp(-dot(panelOffset,panelOffset));
  color+=vec3(0.60,0.90,0.95)*panel;return color;
}
vec3 shadeWater(vec3 point,vec3 rd,vec3 normal,float frontFace){
  float facing=clamp(dot(-rd,normal),0.0,1.0);
  float fresnel=0.025+0.72*pow(1.0-facing,4.0);
  vec3 transmitted=refract(rd,normal,0.7502),wallNormal;float material;
  float distance=roomHit(point+transmitted*0.04,transmitted,wallNormal,material);
  vec3 behind=distance<FAR*0.5?roomColor(point+transmitted*(distance+0.04),wallNormal,material):vec3(0.014,0.04,0.07);
  distance=min(distance,17.0);
  vec3 attenuation=exp(-vec3(0.31,0.105,0.065)*distance);
  vec3 body=behind*attenuation+vec3(0.012,0.18,0.265)*(1.0-attenuation);
  body+=vec3(0.006,0.06,0.065)*exp(-distance*0.10);
  vec3 color=mix(body,environment(reflect(rd,normal)),fresnel);
  vec3 light=normalize(vec3(-0.4,0.82,0.3));
  float spec=pow(max(dot(reflect(-light,normal),-rd),0.0),105.0);
  color+=vec3(0.74,0.98,1.0)*spec*0.9;
  if(frontFace<0.5){
    float crest=(water(point.xz).x-level)/max(amplitude,0.02);
    float foam=smoothstep(0.50,1.0,crest)*smoothstep(0.4,0.82,noise(point.xz*5.0+uTime*0.15));
    color+=vec3(0.23,0.48,0.46)*foam*0.64;
    color+=vec3(0.015,0.12,0.135)*pow(1.0-facing,2.0);
  }else{
    float edge=water(point.xz).x-point.y;
    color+=vec3(0.31,0.67,0.66)*exp(-edge*edge*170.0);
    color+=vec3(0.01,0.03,0.04)*caustic(point.xy*0.55);
  }
  return color;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uResolution*2.0-1.0;
  float aspect=uResolution.x/uResolution.y;
  halfX=5.0*aspect;
  level=-4.65+9.3*uProgress+2.0*smoothstep(0.7,1.0,uProgress);
  amplitude=(0.08+0.70*sin(uProgress*3.14159265))*(0.20+0.80*uIntensity);
  frontZ=4.4*smoothstep(0.42,0.98,uProgress);
  vec3 target=vec3(uv.x*5.35*aspect,uv.y*5.35+0.15,0.0);
  vec3 rd=normalize(target-CAMERA),color=vec3(0.0);float alpha=0.0;
  vec2 q=abs(target.xy-vec2(0.0,0.125))-vec2(halfX,4.875);
  float edge=length(max(q,0.0))+min(max(q.x,q.y),0.0);
  vec3 wallNormal;float material;
  float roomDistance=roomHit(CAMERA,rd,wallNormal,material);
  if(edge<0.0&&roomDistance<FAR*0.5){color=roomColor(CAMERA+rd*roomDistance,wallNormal,material);alpha=0.99;}
  // Lit bevel and outside shadow anchor the opening in the presentation plane.
  float frame=1.0-smoothstep(0.035,0.145,abs(edge));
  if(frame>0.001){
    float bevel=(edge+0.025)*38.0;
    vec3 frameColor=vec3(0.13,0.22,0.265)+vec3(0.19,0.28,0.29)*exp(-bevel*bevel);
    frameColor*=0.68+0.32*smoothstep(-4.5,5.0,target.y);
    color=mix(color,frameColor,frame);alpha=max(alpha,frame);
  }
  if(edge>0.13&&edge<0.5){alpha=max(alpha,exp(-(edge-0.13)*11.0)*0.22);color*=0.4;}
  float enter=(frontZ-CAMERA.z)/rd.z;
  vec3 entrance=CAMERA+rd*enter;
  float hit=FAR,frontFace=0.0;vec3 normal=vec3(0.0);
  bool inWaterWidth=abs(entrance.x)<halfX&&entrance.y>-4.75;
  if(inWaterWidth&&entrance.y<water(entrance.xz).x){
    hit=enter;frontFace=1.0;
    normal=normalize(vec3(0.065*sin(entrance.x*2.0+entrance.y*1.2-uTime*1.5),
      0.045*sin(entrance.y*3.0-entrance.x+uTime*1.2),1.0));
  }else if(rd.y<-0.012){
    float t=clamp((level-CAMERA.y)/rd.y,enter,36.0);
    for(int i=0;i<4;i++){
      vec3 point=CAMERA+rd*t,ws=water(point.xz);
      float derivative=rd.y-ws.y*rd.x-ws.z*rd.z;
      float signedSafe=derivative<0.0?-max(abs(derivative),0.04):max(abs(derivative),0.04);
      t-=clamp((point.y-ws.x)/signedSafe,-5.0,5.0);
    }
    vec3 point=CAMERA+rd*t,ws=water(point.xz);
    if(t>=enter&&t<roomDistance&&point.z>=-8.5&&point.z<=frontZ+0.01&&abs(point.x)<halfX&&abs(point.y-ws.x)<0.13){
      hit=t;normal=normalize(vec3(-ws.y,1.0,-ws.z));
    }
  }
  if(hit<FAR*0.5){color=shadeWater(CAMERA+rd*hit,rd,normal,frontFace);alpha=0.99;}
  color=pow(max(color,vec3(0.0)),vec3(0.88));
  gl_FragColor=vec4(color,alpha*uReveal);
}
`;
const PARTICLE_VERTEX=`
precision highp float;
attribute vec3 aPosition;
attribute vec4 aInfo;
uniform vec2 uResolution;
uniform float uReveal;
varying vec3 vInfo;
void main(){
  float perspective=11.5/max(0.5,11.5-aPosition.z),aspect=uResolution.x/uResolution.y;
  vec2 projected=vec2(aPosition.x*perspective/(5.35*aspect),(3.2+(aPosition.y-3.2)*perspective-0.15)/5.35);
  gl_Position=vec4(projected,0.0,1.0);
  gl_PointSize=clamp(aInfo.x*perspective*uResolution.y/5.35,1.0,46.0);
  vInfo=vec3(aInfo.y,aInfo.z*uReveal,aInfo.w);
}
`;
const PARTICLE_FRAGMENT=`
precision mediump float;
varying vec3 vInfo;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0;p.x*=vInfo.z;
  float r2=dot(p,p);if(r2>1.0)discard;
  vec3 normal=vec3(p.x,-p.y,sqrt(1.0-r2));
  float spec=pow(max(dot(normal,normalize(vec3(-0.5,0.6,0.9))),0.0),24.0),edge=pow(r2,3.0);
  vec3 color=mix(vec3(0.09,0.50,0.62),vec3(0.65,0.97,1.0),edge*0.7+spec);
  float opacity=mix(edge*0.55+spec*0.8,0.44+edge*0.30+spec*0.5,vInfo.x);
  gl_FragColor=vec4(color,opacity*vInfo.y*(1.0-smoothstep(0.82,1.0,r2)));
}
`;

/** Projected Canvas mesh fallback for browsers where WebGL is disabled. */
class ProjectedWater {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});this.width=this.height=1;this.dpr=1;this.resize();}
  resize(){
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    this.width=rect.width;this.height=rect.height;
    this.dpr=Math.min(2,globalThis.devicePixelRatio||1,Math.sqrt(1200000/(rect.width*rect.height)));
    this.canvas.width=Math.round(rect.width*this.dpr);this.canvas.height=Math.round(rect.height*this.dpr);
  }
  project(x,y,z){
    const k=11.5/(11.5-z);
    return[this.width*0.5+x*k*this.height/10.7,this.height*0.5-(3.2+(y-3.2)*k-0.15)*this.height/10.7];
  }
  polygon(vertices,fill,stroke){
    const ctx=this.ctx;ctx.beginPath();
    vertices.forEach((v,i)=>{const p=this.project(...v);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
  }
  render({time,progress,intensity,reveal}){
    const ctx=this.ctx;if(!ctx)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    if(reveal<0.001)return;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.globalAlpha=reveal;
    const x=5*this.width/this.height,front=surge(progress);
    this.polygon([[-x,-4.75,-8.5],[x,-4.75,-8.5],[x,5,-8.5],[-x,5,-8.5]],'#132937');
    this.polygon([[-x,-4.75,0],[x,-4.75,0],[x,-4.75,-8.5],[-x,-4.75,-8.5]],'#1a333e');
    this.polygon([[-x,-4.75,0],[-x,-4.75,-8.5],[-x,5,-8.5],[-x,5,0]],'#0c222f');
    this.polygon([[x,-4.75,0],[x,-4.75,-8.5],[x,5,-8.5],[x,5,0]],'#0f2735');
    this.polygon([[-x,5,0],[x,5,0],[x,5,-8.5],[-x,5,-8.5]],'#091924');
    ctx.strokeStyle='rgba(126,185,192,.22)';ctx.lineWidth=0.8;
    for(let n=-Math.floor(x);n<=Math.floor(x);n++){
      ctx.beginPath();ctx.moveTo(...this.project(n,-4.74,0));ctx.lineTo(...this.project(n,-4.74,-8.5));ctx.stroke();
    }
    for(let z=0;z>=-8;z--){ctx.beginPath();ctx.moveTo(...this.project(-x,-4.74,z));ctx.lineTo(...this.project(x,-4.74,z));ctx.stroke();}
    // Refracted light on the real receding floor, visible through the surface.
    ctx.lineWidth=1.3;ctx.strokeStyle='rgba(90,237,234,.42)';
    for(let n=0;n<19;n++){
      const cx=(random(n+67)*2-1)*x,cz=-random(n+85)*8;
      ctx.beginPath();
      for(let j=0;j<=25;j++){
        const a=j/25*Math.PI*2;
        const wobble=1+Math.sin(a*3+time*.4+n)*.20;
        const v=this.project(cx+Math.cos(a)*(.4+random(n+19)*.65)*wobble,-4.73,
          cz+Math.sin(a)*(.25+random(n+52)*.5)*wobble);
        j?ctx.lineTo(...v):ctx.moveTo(...v);
      }
      ctx.stroke();
    }
    ctx.lineWidth=2;
    this.polygon([[-x,-4.75,0],[x,-4.75,0],[x,5,0],[-x,5,0]],null,'rgba(133,186,195,.65)');
    // Interpolated shading on the projected mesh keeps the fallback fluid.
    const nx=this.width<700?32:56,nz=this.width<700?24:32;
    const mesh=[];
    const tint=light=>`rgb(${Math.round(9+light*102)},${Math.round(98+light*124)},${Math.round(135+light*104)})`;
    for(let iz=0;iz<=nz;iz++){
      const z=-8.5+(8.5+front)*iz/nz,row=[];
      for(let ix=0;ix<=nx;ix++){
        const px=-x+2*x*ix/nx,y=waveHeight(px,z,time,progress,intensity);
        const dx=(waveHeight(px+.025,z,time,progress,intensity)-y)/.025;
        const dz=(waveHeight(px,z+.025,time,progress,intensity)-y)/.025;
        const normalLength=Math.hypot(dx,1,dz);
        const lit=(-dx*-.34+.88-dz*.32)/normalLength;
        const spec=Math.max(0,(-dx*-.24+.92-dz*.55)/(normalLength*1.098))**32;
        const shine=clamp(.08+lit*.32+spec*.30,0,.83);
        row.push({world:[px,y,z],screen:this.project(px,y,z),shine});
      }
      mesh.push(row);
    }
    ctx.lineWidth=.6;
    for(let iz=0;iz<nz;iz++){
      for(let ix=0;ix<nx;ix++){
        const a=mesh[iz][ix],b=mesh[iz][ix+1],c=mesh[iz+1][ix+1],d=mesh[iz+1][ix];
        const gradient=ctx.createLinearGradient((a.screen[0]+b.screen[0])*.5,(a.screen[1]+b.screen[1])*.5,
          (c.screen[0]+d.screen[0])*.5,(c.screen[1]+d.screen[1])*.5+.01);
        gradient.addColorStop(0,tint((a.shine+b.shine)*.5));gradient.addColorStop(1,tint((c.shine+d.shine)*.5));
        this.polygon([a.world,b.world,c.world,d.world],gradient,gradient);
      }
    }
    // Fine traveling reflective ribbons sit on the actual displaced surface.
    for(let n=0;n<11;n++){
      const z=-8.1+(8.1+front)*n/11;
      ctx.beginPath();
      for(let j=0;j<=48;j++){
        const px=-x+2*x*j/48,wz=z+Math.sin(px*.7+time*.6+n)*.11;
        const v=this.project(px,waveHeight(px,wz,time,progress,intensity)+.014,wz);
        j?ctx.lineTo(...v):ctx.moveTo(...v);
      }
      ctx.lineWidth=.65;ctx.strokeStyle=`rgba(189,255,251,${.045+Math.max(0,Math.sin(n+time*.2))*.075})`;ctx.stroke();
    }
    const waterFront=[];
    for(let i=0;i<=64;i++){const px=-x+2*x*i/64;waterFront.push([px,waveHeight(px,front,time,progress,intensity),front]);}
    const volume=ctx.createLinearGradient(0,this.height*0.2,0,this.height);
    volume.addColorStop(0,'rgba(24,163,191,.86)');volume.addColorStop(0.55,'rgba(7,96,143,.91)');volume.addColorStop(1,'rgba(2,39,80,.96)');
    this.polygon([...waterFront,[x,-4.75,front],[-x,-4.75,front]],volume);
    ctx.save();ctx.clip();
    // Light shafts remain clipped inside the protruding water volume.
    for(let i=0;i<5;i++){
      const sx=this.width*(i*.25-.1+Math.sin(time*.13+i)*.02);
      const beam=ctx.createLinearGradient(sx,0,sx+this.width*.18,this.height);
      beam.addColorStop(0,'rgba(121,248,248,.12)');beam.addColorStop(1,'rgba(27,112,180,0)');
      ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx+this.width*.055,0);
      ctx.lineTo(sx+this.width*.34,this.height);ctx.lineTo(sx+this.width*.13,this.height);ctx.closePath();ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();waterFront.forEach((p,i)=>{const v=this.project(...p);i?ctx.lineTo(...v):ctx.moveTo(...v);});
    ctx.strokeStyle='rgba(124,246,242,.18)';ctx.lineWidth=8;ctx.stroke();
    ctx.strokeStyle='rgba(202,255,247,.91)';ctx.lineWidth=1.6;ctx.stroke();
    for(let i=0;i<47;i++){
      const age=fract(random(i+521)+time*(.028+random(i+789)*.018));
      const px=(random(i+317)*2-1)*x*.94,z=-7.8+random(i+814)*(7.8+front),y=-4.5+age*10.5;
      if(y>waveHeight(px,z,time,progress,intensity)-.25)continue;
      const v=this.project(px,y,z),radius=(1+random(i+889)**2*3.0)*11.5/(11.5-z);
      ctx.beginPath();ctx.arc(...v,radius,0,Math.PI*2);ctx.lineWidth=.65;
      ctx.strokeStyle='rgba(181,249,255,.32)';ctx.stroke();
    }
    const splash=Math.sin(Math.PI*progress)*smooth(.13,.32,progress)*intensity;
    if(splash>.025)for(let i=0;i<18;i++){
      const age=fract(time*(.65+random(i+212)*.18)+random(i+334));
      const px=(random(i+199)*2-1)*x*.95+(random(i+89)-.5)*age*1.4;
      const z=front+.12+age*(1.1+random(i+435)*1.9);
      const y=waveHeight(px,front,time-age*.7,progress,intensity)+(age*(2.7+random(i+289)*2.8)-age*age*6)*splash;
      if(y<waveHeight(px,z,time,progress,intensity)-.13)continue;
      const v=this.project(px,y,z),radius=(1.2+random(i+187)**2*3.8)*11.5/(11.5-z);
      const gleam=ctx.createRadialGradient(v[0]-radius*.35,v[1]-radius*.35,0,v[0],v[1],radius);
      gleam.addColorStop(0,'rgba(240,255,255,.98)');gleam.addColorStop(.25,'rgba(130,241,249,.76)');
      gleam.addColorStop(1,'rgba(9,107,150,.48)');ctx.fillStyle=gleam;
      ctx.beginPath();ctx.ellipse(...v,radius,radius*1.15,0,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  dispose(){if(this.ctx){this.ctx.setTransform(1,0,0,1,0,0);this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}this.ctx=null;}
}
function locations(gl,program,names){return Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));}
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const fract=value=>value-Math.floor(value);
const random=seed=>fract(Math.sin(seed*127.1+311.7)*43758.5453123);
function smooth(min,max,value){const t=clamp((value-min)/(max-min),0,1);return t*t*(3-2*t);}
function waterLevel(p){return -4.65+9.3*p+2*smooth(0.7,1,p);}
function surge(p){return 4.4*smooth(0.42,0.98,p);}
function waveHeight(x,z,time,p,intensity){
  const amplitude=(0.08+0.70*Math.sin(p*Math.PI))*(0.20+0.80*intensity);
  const center=-7+11*smooth(0.1,0.88,p);
  const packet=Math.exp(-((z-center)**2)*0.34)*(0.78+0.22*Math.sin(x*0.7-time*0.7))*0.8;
  return waterLevel(p)+amplitude*(0.48*Math.sin(x*0.48+z*0.62-time*1.45)
    +0.24*Math.sin(x*1.10-z*0.88-time*1.95+1.3)
    +0.095*Math.sin(x*2.35+z*1.90-time*2.5)+0.025*Math.sin(x*4.50-z*3.60-time*3.2)+packet)
    -x*Math.sin(p*Math.PI)*0.022;
}
