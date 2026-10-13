// Vendoring entry for dist/vendor/three-bundle.mjs: only the three.js classes dist/twin.mjs imports.
// Rebuild (three is not a runtime dependency; the bundle is committed):
//   npm i --no-save three@0.186.1 esbuild@0.25.10
//   npx esbuild scripts/three-entry.mjs --bundle --format=esm --minify --legal-comments=inline --outfile=dist/vendor/three-bundle.mjs
export {Scene,PerspectiveCamera,WebGLRenderer,Color,Fog,HemisphereLight,DirectionalLight,Group,Mesh,InstancedMesh,Object3D,BoxGeometry,CylinderGeometry,SphereGeometry,ConeGeometry,PlaneGeometry,CircleGeometry,TorusGeometry,OctahedronGeometry,EdgesGeometry,LineSegments,LineBasicMaterial,LineDashedMaterial,Line,BufferGeometry,MeshStandardMaterial,MeshBasicMaterial,Vector2,Vector3,Raycaster,QuadraticBezierCurve3,CanvasTexture,PCFShadowMap,DoubleSide,SRGBColorSpace} from 'three';
export {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
