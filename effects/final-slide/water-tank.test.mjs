import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterTank} from './water-tank.mjs';

function surface({webgl=true,loseExtension=true,renderer=null,debugError=null}={}) {
  const calls=[],listeners=new Map();
  const stats={shaderCompiles:0};
  let nextId=0,lost=false;
  const ctx={setTransform:()=>calls.push('2d-transform'),clearRect:()=>calls.push('2d-clear')};
  const canvas={
    width:0,height:0,dataset:{},listeners,calls,ctx,
    getBoundingClientRect:()=>({width:1280,height:720}),
    addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    dispatch(type,event){listeners.get(type)?.(event);},
    cloneNode(){return surface({webgl:false}).canvas;},
    replaceWith(replacement){this.replacement=replacement;},
    getContext(type){return type==='webgl'?(webgl?gl:null):ctx;},
  };
  const gl={
    VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,LINK_STATUS:35714,
    ARRAY_BUFFER:34962,STATIC_DRAW:35044,COLOR_BUFFER_BIT:16384,
    createProgram:()=>({id:++nextId,kind:'program'}),createShader:()=>({id:++nextId,kind:'shader'}),
    createBuffer:()=>({id:++nextId,kind:'buffer'}),
    shaderSource(){},compileShader(){++stats.shaderCompiles;},getShaderParameter:()=>true,attachShader(){},
    deleteShader(){},linkProgram(){},getProgramParameter:()=>true,
    bindBuffer(){},bufferData(){},getUniformLocation:()=>({}),getAttribLocation:()=>0,viewport(){},
    deleteProgram:item=>calls.push(['delete-program',item]),
    deleteBuffer:item=>calls.push(['delete-buffer',item]),
    clearColor:()=>calls.push('clear-color'),clear:()=>calls.push('clear'),
    isContextLost:()=>lost,
    getParameter(){if(debugError==='parameter')throw new Error('Renderer query unavailable');return renderer;},
    getExtension(name){
      if(name==='WEBGL_debug_renderer_info'){
        if(debugError==='extension')throw new Error('Renderer extension unavailable');
        return renderer===null?null:{UNMASKED_RENDERER_WEBGL:37446};
      }
      assert.equal(name,'WEBGL_lose_context');
      calls.push('get-lose-extension');
      return loseExtension?{loseContext(){
        // Disposal must not invoke the fallback listener while releasing GL.
        assert.equal(listeners.size,0);
        calls.push('lose-context');lost=true;
        canvas.dispatch('webglcontextlost',{preventDefault(){}});
      }}:null;
    },
  };
  return {canvas,gl,calls,stats,loseBeforeEvent(){lost=true;}};
}

test('confirmed GT 730 Direct3D11 driver uses Canvas before any wave shader compilation',()=>{
  const {canvas,gl,calls,stats}=surface({
    renderer:'ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00001287) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  });
  const tank=new WaterTank(canvas),replacement=canvas.replacement;
  assert.equal(stats.shaderCompiles,0);
  assert.deepEqual(tank.resources,[]);
  assert.equal(tank.gl,null);assert.equal(tank.ready,false);
  assert.equal(canvas.listeners.size,0);assert.equal(gl.isContextLost(),true);
  assert.equal(calls.filter(call=>call==='lose-context').length,1);
  assert.equal(tank.canvas,replacement);assert.ok(tank.fallback.ctx);
  assert.equal(replacement.dataset.renderer,'canvas-fallback');
  assert.equal(replacement.dataset.rendererReason,'driver-compatibility');
  tank.dispose();tank.dispose();
  assert.equal(replacement.width,1);assert.equal(replacement.height,1);
  assert.equal(calls.filter(call=>call==='lose-context').length,1);
});

test('other GPUs and other GT 730 backends keep the WebGL renderer and normal cleanup',()=>{
  for(const renderer of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GT 730, OpenGL 4.6)',
  ]){
    const {canvas,gl,calls,stats}=surface({renderer});
    const tank=new WaterTank(canvas);
    assert.equal(stats.shaderCompiles,4);assert.equal(tank.ready,true);
    assert.equal(tank.gl,gl);assert.equal(canvas.replacement,undefined);
    assert.equal(canvas.dataset.renderer,'webgl');
    tank.dispose();
    assert.equal(calls.filter(call=>call==='lose-context').length,1);
    assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='delete-program').length,2);
  }
});

test('missing or rejected renderer diagnostics leave the existing WebGL path available',()=>{
  for(const options of [{},{debugError:'extension'},{renderer:'unavailable',debugError:'parameter'}]){
    const {canvas,stats}=surface(options);
    const tank=new WaterTank(canvas);
    assert.equal(tank.ready,true);assert.equal(stats.shaderCompiles,4);
    assert.equal(canvas.replacement,undefined);
    tank.dispose();
  }
});

test('disposing the wave releases its owned GPU resources and context exactly once',()=>{
  const {canvas,gl,calls}=surface();
  const tank=new WaterTank(canvas);
  assert.equal(tank.ready,true);
  const resources=[...tank.resources];
  tank.latestFrame={time:1,progress:.5,intensity:1,reveal:1};
  tank.dispose();
  for(const [type,item] of resources){
    assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]===`delete-${type}`&&call[1]===item).length,1);
  }
  assert.equal(calls.filter(call=>call==='lose-context').length,1);
  assert.equal(canvas.listeners.size,0);
  assert.equal(canvas.replacement,undefined);
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
  assert.equal(tank.gl,null);assert.equal(tank.particleData,null);assert.equal(tank.latestFrame,null);
  assert.equal(tank.ready,false);assert.equal(tank.disposed,true);
  assert.deepEqual(tank.resources,[]);
  assert.equal(gl.isContextLost(),true);
  const after=[...calls];
  tank.dispose();tank.resize();tank.render({progress:.5});
  assert.deepEqual(calls,after);
});

test('disposal handles a context already lost before the browser dispatched its event',()=>{
  const {canvas,calls,loseBeforeEvent}=surface();
  const tank=new WaterTank(canvas);
  loseBeforeEvent();
  tank.dispose();tank.dispose();
  assert.deepEqual(calls,[]);
  assert.equal(canvas.listeners.size,0);
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
  assert.equal(tank.gl,null);assert.deepEqual(tank.resources,[]);
});

test('without the loss extension disposal still deletes resources and shrinks the buffer',()=>{
  const {canvas,calls}=surface({loseExtension:false});
  const tank=new WaterTank(canvas);
  tank.dispose();
  assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='delete-program').length,2);
  assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='delete-buffer').length,2);
  assert.equal(calls.filter(call=>call==='lose-context').length,0);
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);assert.equal(tank.gl,null);
  const after=[...calls];tank.dispose();assert.deepEqual(calls,after);
});

test('disposing a Canvas fallback releases its drawing buffer and renderer references',()=>{
  const {canvas,calls}=surface({webgl:false});
  const tank=new WaterTank(canvas),fallback=tank.fallback;
  assert.ok(fallback.ctx);
  tank.dispose();
  assert.equal(fallback.ctx,null);assert.equal(tank.fallback,null);
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
  assert.equal(tank.particleData,null);assert.equal(tank.latestFrame,null);
  assert.deepEqual(calls,['2d-transform','2d-clear']);
  tank.dispose();assert.deepEqual(calls,['2d-transform','2d-clear']);
});

test('disposal after WebGL loss cleans the replacement fallback canvas without reviving GL',()=>{
  const {canvas,calls,loseBeforeEvent}=surface();
  const tank=new WaterTank(canvas);
  loseBeforeEvent();
  let prevented=false;
  canvas.dispatch('webglcontextlost',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(canvas.listeners.size,0);
  const replacement=canvas.replacement,fallback=tank.fallback;
  assert.equal(tank.canvas,replacement);assert.ok(fallback.ctx);
  tank.dispose();tank.dispose();
  assert.equal(fallback.ctx,null);assert.equal(tank.fallback,null);
  assert.equal(replacement.width,1);assert.equal(replacement.height,1);
  assert.deepEqual(calls,[]);
  assert.equal(tank.gl,null);assert.equal(tank.ready,false);
});
