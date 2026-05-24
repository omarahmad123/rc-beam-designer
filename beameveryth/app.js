// Complete bar database with international standards
const barDatabase = {
  10: { dia: 10, area: 78.5, name: "#3 (10mm)", region: "USA, Europe, Asia" },
  12: { dia: 12, area: 113.1, name: "#4 (12mm)", region: "USA, Europe, Asia, Middle East" },
  13: { dia: 13, area: 132.7, name: "#4.5 (13mm)", region: "Europe, Asia" },
  14: { dia: 14, area: 153.9, name: "#5 (14mm)", region: "Europe, Asia, Middle East" },
  16: { dia: 16, area: 201.1, name: "#5.5 (16mm)", region: "USA, Europe, Asia, Middle East" },
  18: { dia: 18, area: 254.5, name: "#6 (18mm)", region: "Europe, Asia, Middle East" },
  19: { dia: 19, area: 283.5, name: "#6 (19mm)", region: "USA, Canada" },
  20: { dia: 20, area: 314.2, name: "#6.5 (20mm)", region: "Europe, Asia, Middle East" },
  22: { dia: 22, area: 380.1, name: "#7 (22mm)", region: "Europe, Asia" },
  25: { dia: 25, area: 490.9, name: "#8 (25mm)", region: "USA, Europe, Asia, Middle East" },
  28: { dia: 28, area: 615.8, name: "#9 (28mm)", region: "Europe, Asia" },
  29: { dia: 29, area: 660.5, name: "#9 (29mm)", region: "USA" },
  32: { dia: 32, area: 804.2, name: "#10 (32mm)", region: "USA, Europe, Asia, Middle East" },
  36: { dia: 36, area: 1017.9, name: "#11 (36mm)", region: "USA, Europe" },
  40: { dia: 40, area: 1256.6, name: "#14 (40mm)", region: "USA, Europe" },
  43: { dia: 43, area: 1452.2, name: "#18 (43mm)", region: "USA" }
};

const phiFlexure = 0.9;
const phiShear = 0.75;
const concreteDensity = 24;
const Es = 200000;
let currentBestOption = null;
let allViableOptions = [];

// ========== 3D VISUALIZATION VARIABLES ==========
let scene, camera, renderer, controls, currentBeamGroup;
let wireframeMode = false;

function toggleTopBars() {
  const show = document.getElementById("includeTopBars").checked;
  document.getElementById("topBarsInputs").style.display = show ? "block" : "none";
}

function calculateSelfWeight(b, h) {
  const area_m2 = (b * h) / 1000000;
  return concreteDensity * area_m2;
}

function solveRequiredSteel(Mu_kNm, b, d, fc, fy) {
  const Mu = Mu_kNm * 1e6;
  const Rn = Mu / (phiFlexure * b * d * d);
  if (Rn <= 0) return null;
  const rho = (0.85 * fc / fy) * (1 - Math.sqrt(1 - 2 * Rn / (0.85 * fc)));
  if (isNaN(rho) || rho <= 0) return null;
  return rho * b * d;
}

function computeMn(As, b, d, fc, fy) {
  const a = As * fy / (0.85 * fc * b);
  return As * fy * (d - a/2) / 1e6;
}

function computeMnWithTopBars(As_bottom, As_top, b, d, d_top, fc, fy) {
  const a = (As_bottom - As_top) * fy / (0.85 * fc * b);
  const Mn = (As_bottom - As_top) * fy * (d - a/2) / 1e6 + As_top * fy * (d - d_top) / 1e6;
  return Mn;
}

function checkSpacing(b, cover, n, barDia) {
  const stirrupDia = parseFloat(document.getElementById("stirrupDia").value) || 8;
  const minSpacing = Math.max(25, barDia);
  const availableWidth = b - 2 * cover - 2 * stirrupDia;
  const requiredWidth = n * barDia + (n - 1) * minSpacing;
  return requiredWidth <= availableWidth;
}

function findAllViableOptions(Mu, b, d, fc, fy) {
  const options = [];
  const cover = parseFloat(document.getElementById("cover").value);
  for (const [dia, bar] of Object.entries(barDatabase)) {
    for (let n = 1; n <= 8; n++) {
      const As = n * bar.area;
      if (!checkSpacing(b, cover, n, bar.dia)) continue;
      const Mn = computeMn(As, b, d, fc, fy);
      const phiMn = phiFlexure * Mn;
      if (phiMn >= Mu) {
        options.push({
          dia: parseInt(dia), diaName: bar.name, region: bar.region,
          n: n, As: As, d: d, Mn: Mn, phiMn: phiMn,
          efficiency: Mu / phiMn, steelCost: As
        });
      }
    }
  }
  options.sort((a, b) => Math.abs(a.efficiency - 1) - Math.abs(b.efficiency - 1));
  return options;
}

function findBestEconomicOption(options) {
  if (options.length === 0) return null;
  let best = options[0];
  for (let i = 1; i < options.length; i++) {
    if (Math.abs(options[i].efficiency - 1) < Math.abs(best.efficiency - 1) - 0.02) {
      best = options[i];
    }
  }
  return best;
}

function calculateIe(b, h, As, d, fc, fy, Ma_Nmm, As_top) {
  const Ig = b * Math.pow(h, 3) / 12;
  const fr = 0.62 * Math.sqrt(fc);
  const yt = h / 2;
  const Mcr = fr * Ig / yt;
  const n = Es / (4700 * Math.sqrt(fc));
  const c = (Math.sqrt(Math.pow(n * As, 2) + 2 * b * n * As * d) - n * As) / b;
  const Icr = (b * Math.pow(c, 3)) / 3 + n * As * Math.pow(d - c, 2);
  let Ie = Ig;
  if (Ma_Nmm > Mcr) {
    const ratio = Mcr / Ma_Nmm;
    Ie = Math.pow(ratio, 3) * Ig + (1 - Math.pow(ratio, 3)) * Icr;
  }
  if (As_top > 0) Ie = Math.min(Ig, Ie * 1.2);
  return Ie;
}

function calculateDeflection(L_mm, w_serv, Ec, Ie) {
  return (5 * w_serv * Math.pow(L_mm, 4)) / (384 * Ec * Ie);
}

// ========== 3D VISUALIZATION FUNCTIONS (FIXED) ==========
function init3D() {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1c);
  scene.fog = new THREE.FogExp2(0x0a0f1c, 0.008);
  
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(4, 3, 5);
  camera.lookAt(0, 0, 0);
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = false;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.zoomSpeed = 1.2;
  
  const ambientLight = new THREE.AmbientLight(0x404060);
  scene.add(ambientLight);
  
  const mainLight = new THREE.DirectionalLight(0xffffff, 1);
  mainLight.position.set(5, 10, 7);
  mainLight.castShadow = true;
  scene.add(mainLight);
  
  const fillLight = new THREE.PointLight(0x4466cc, 0.3);
  fillLight.position.set(-2, 1, 3);
  scene.add(fillLight);
  
  const backLight = new THREE.PointLight(0xffaa66, 0.2);
  backLight.position.set(0, 1, -3);
  scene.add(backLight);
  
  const gridHelper = new THREE.GridHelper(10, 20, 0x335588, 0x224466);
  gridHelper.position.y = -0.6;
  scene.add(gridHelper);
  
  animate3D();
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (controls) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function update3DBeam(b, h, L, bottomBars, topBars, stirrupDia, stirrupSpacing) {
  if (!scene) init3D();
  
  if (currentBeamGroup) {
    scene.remove(currentBeamGroup);
  }
  
  currentBeamGroup = new THREE.Group();
  
  const L_m = L;
  const b_m = b / 1000;
  const h_m = h / 1000;
  const cover_m = 0.04; // 40mm cover in meters
  
  // 1. Concrete beam (semi-transparent)
  const concreteGeo = new THREE.BoxGeometry(L_m, h_m, b_m);
  const concreteMat = new THREE.MeshPhongMaterial({
    color: 0x88aaff,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide
  });
  const concreteBeam = new THREE.Mesh(concreteGeo, concreteMat);
  concreteBeam.castShadow = true;
  concreteBeam.position.set(0, 0, 0);
  currentBeamGroup.add(concreteBeam);
  
  // 2. Wireframe outline
  const edgesGeo = new THREE.EdgesGeometry(concreteGeo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x88aaff });
  const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
  wireframe.position.copy(concreteBeam.position);
  currentBeamGroup.add(wireframe);
  
  // 3. Bottom reinforcement bars (orange) - running ALONG the beam length (X-axis)
  if (bottomBars && bottomBars.n > 0) {
    const bottomY = -h_m/2 + cover_m + 0.015; // Position near bottom
    const barDia_m = bottomBars.dia / 1000;
    const barRadius_m = barDia_m / 2;
    // Spacing along width (Z-axis)
    const spacingZ = (b_m - 2 * cover_m) / (bottomBars.n - 1);
    let startZ = -b_m/2 + cover_m + barRadius_m;
    
    for (let i = 0; i < bottomBars.n; i++) {
      // Cylinder with rotation: default cylinder is along Y, rotate to X
      const barGeo = new THREE.CylinderGeometry(barRadius_m, barRadius_m, L_m, 16);
      const barMat = new THREE.MeshPhongMaterial({ color: 0xff6600, emissive: 0x441100 });
      const bar = new THREE.Mesh(barGeo, barMat);
      // Rotate cylinder to align with X-axis
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, bottomY, startZ + i * spacingZ);
      bar.castShadow = true;
      currentBeamGroup.add(bar);
    }
  }
  
  // 4. Top reinforcement bars (blue) - running ALONG the beam length (X-axis)
  if (topBars && topBars.n > 0 && topBars.dia) {
    const topY = h_m/2 - cover_m - 0.015; // Position near top
    const barDia_m = topBars.dia / 1000;
    const barRadius_m = barDia_m / 2;
    // Spacing along width (Z-axis)
    const spacingZ = (b_m - 2 * cover_m) / (topBars.n - 1);
    let startZ = -b_m/2 + cover_m + barRadius_m;
    
    for (let i = 0; i < topBars.n; i++) {
      const barGeo = new THREE.CylinderGeometry(barRadius_m, barRadius_m, L_m, 16);
      const barMat = new THREE.MeshPhongMaterial({ color: 0x44aaff, emissive: 0x004466 });
      const bar = new THREE.Mesh(barGeo, barMat);
      // Rotate cylinder to align with X-axis
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, topY, startZ + i * spacingZ);
      bar.castShadow = true;
      currentBeamGroup.add(bar);
    }
  }
  
  // 5. Stirrups (yellow wireframe loops) - vertical loops around the beam
  if (stirrupSpacing && stirrupSpacing > 0 && stirrupSpacing < L_m * 1000) {
    const stirrupSpacing_m = stirrupSpacing / 1000;
    const numStirrups = Math.floor(L_m / stirrupSpacing_m) + 1;
    
    for (let i = 0; i <= numStirrups; i++) {
      const xPos = -L_m/2 + i * stirrupSpacing_m;
      if (Math.abs(xPos) > L_m/2) continue;
      
      // Create stirrup loop points (rectangle around cross-section)
      const stirrupPoints = [
        new THREE.Vector3(xPos, -h_m/2 + cover_m, -b_m/2 + cover_m),
        new THREE.Vector3(xPos, -h_m/2 + cover_m,  b_m/2 - cover_m),
        new THREE.Vector3(xPos,  h_m/2 - cover_m,  b_m/2 - cover_m),
        new THREE.Vector3(xPos,  h_m/2 - cover_m, -b_m/2 + cover_m),
        new THREE.Vector3(xPos, -h_m/2 + cover_m, -b_m/2 + cover_m)
      ];
      
      const stirrupLineGeo = new THREE.BufferGeometry();
      const vertices = [];
      stirrupPoints.forEach(p => {
        vertices.push(p.x, p.y, p.z);
      });
      stirrupLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
      const stirrupMat = new THREE.LineBasicMaterial({ color: 0xffaa44 });
      const stirrupLoop = new THREE.Line(stirrupLineGeo, stirrupMat);
      currentBeamGroup.add(stirrupLoop);
    }
  }
  
  scene.add(currentBeamGroup);
}

function reset3DView() {
  if (camera && controls) {
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  }
}

function toggleWireframe3D() {
  if (!currentBeamGroup) return;
  wireframeMode = !wireframeMode;
  currentBeamGroup.children.forEach(child => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => mat.wireframe = wireframeMode);
      } else {
        child.material.wireframe = wireframeMode;
      }
    }
  });
}

function screenshot3D() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const dataURL = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'beam_3d_view.png';
  link.href = dataURL;
  link.click();
}

// ========== MAIN RUN DESIGN FUNCTION ==========
function runDesign() {
  const span = parseFloat(document.getElementById("span").value);
  const wD_user = parseFloat(document.getElementById("wD").value);
  const wL = parseFloat(document.getElementById("wL").value);
  const b = parseFloat(document.getElementById("b").value);
  const h = parseFloat(document.getElementById("h").value);
  const cover = parseFloat(document.getElementById("cover").value);
  const fc = parseFloat(document.getElementById("fc").value);
  const fy = parseFloat(document.getElementById("fy").value);
  const includeSelfWeight = document.getElementById("includeSelfWeight").checked;
  const stirrupDia = parseFloat(document.getElementById("stirrupDia").value);
  const stirrupLegs = parseFloat(document.getElementById("stirrupLegs").value);
  const fyStirrup = parseFloat(document.getElementById("fyStirrup").value);
  const userSpacing = parseFloat(document.getElementById("stirrupSpacing").value);
  const memberType = parseFloat(document.getElementById("memberType").value);
  const includeTopBars = document.getElementById("includeTopBars").checked;
  const topBarDia = includeTopBars ? parseFloat(document.getElementById("topBarDia").value) : 0;
  const topBarsCount = includeTopBars ? parseFloat(document.getElementById("topBarsCount").value) : 0;
  
  const errorEl = document.getElementById("error");
  if ([span, wD_user, wL, b, h, cover, fc, fy, fyStirrup].some(v => isNaN(v) || v <= 0)) {
    errorEl.textContent = "❌ Please fill all basic fields with positive numbers.";
    drawEmptyState();
    return;
  }
  
  const selfWeight = calculateSelfWeight(b, h);
  const totalWD = includeSelfWeight ? wD_user + selfWeight : wD_user;
  
  const selfWeightInfo = document.getElementById("selfWeightInfo");
  if (includeSelfWeight) {
    selfWeightInfo.style.display = "block";
    selfWeightInfo.innerHTML = `📐 Self-weight = ${selfWeight.toFixed(2)} kN/m<br>Total Dead Load = ${totalWD.toFixed(2)} kN/m (user: ${wD_user.toFixed(2)} + self: ${selfWeight.toFixed(2)})`;
  } else {
    selfWeightInfo.style.display = "none";
  }
  
  const wu = 1.2 * totalWD + 1.6 * wL;
  const w_serv = totalWD + wL;
  const Mu = wu * span * span / 8;
  const Vu = wu * span / 2;
  
  drawShearMoment(span, wu, Vu, b, h, cover, fc);
  
  const d = h - cover - stirrupDia - 16;
  const d_top = cover + stirrupDia + 8;
  const requiredAs = solveRequiredSteel(Mu, b, d, fc, fy);
  
  if (!requiredAs) {
    errorEl.textContent = "Cannot compute required steel. Increase dimensions.";
    return;
  }
  
  allViableOptions = findAllViableOptions(Mu, b, d, fc, fy);
  if (allViableOptions.length === 0) {
    errorEl.textContent = "No feasible reinforcement found! Increase b or h.";
    return;
  }
  
  const bestOption = findBestEconomicOption(allViableOptions);
  currentBestOption = bestOption;
  
  const topAs = includeTopBars ? topBarsCount * (Math.PI * topBarDia * topBarDia / 4) : 0;
  const phiMnFinal = includeTopBars ? 
    computeMnWithTopBars(bestOption.As, topAs, b, d, d_top, fc, fy) : 
    bestOption.phiMn;
  
  drawSection(b, h, cover, bestOption, includeTopBars, topBarDia, topBarsCount);
  
  const bestLabel = document.getElementById("bestOptionLabel");
  bestLabel.innerHTML = `🏆 BEST: ${bestOption.n} × Ø${bestOption.dia}mm | As = ${bestOption.As.toFixed(0)} mm² | φMn = ${phiMnFinal.toFixed(1)} kN·m | ${(bestOption.efficiency*100).toFixed(1)}%${includeTopBars ? ` | Top bars: ${topBarsCount}Ø${topBarDia}` : ""}`;
  bestLabel.classList.add("active");
  
  displayAlternatives(allViableOptions, bestOption);
  displayAllDiameters(Mu, b, d, fc, fy);
  
  const minSteel = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy) * b * d;
  
  document.getElementById("outputFlexure").innerHTML = `
═══════════════════════════════════════════
📊 LOAD SUMMARY
═══════════════════════════════════════════
Span L = ${span.toFixed(2)} m
Width b = ${b} mm, Total h = ${h} mm
d = ${d.toFixed(1)} mm
Total Dead Load = ${totalWD.toFixed(2)} kN/m
Live Load = ${wL.toFixed(2)} kN/m
M_u = ${Mu.toFixed(2)} kN·m

═══════════════════════════════════════════
🏆 FLEXURAL DESIGN
═══════════════════════════════════════════
Bottom bars: ${bestOption.n} × Ø${bestOption.dia} mm
As_bottom = ${bestOption.As.toFixed(0)} mm² (req: ${requiredAs.toFixed(0)})
${includeTopBars ? `Top bars: ${topBarsCount} × Ø${topBarDia} mm\nAs_top = ${topAs.toFixed(0)} mm²` : "No top bars (compression steel)"}
φM_n = ${phiMnFinal.toFixed(1)} kN·m
Utilization = ${(bestOption.efficiency*100).toFixed(1)}%
As_min = ${minSteel.toFixed(0)} mm² → ${bestOption.As >= minSteel ? "✓ OK" : "✗ LOW"}`;
  
  const recommendedSpacing = performShearDesign(Vu, b, d, fc, fyStirrup, stirrupDia, stirrupLegs, userSpacing);
  
  const Ec = 4700 * Math.sqrt(fc);
  const Ma = w_serv * span * span / 8 * 1e6;
  const Ie = calculateIe(b, h, bestOption.As, d, fc, fy, Ma, topAs);
  const L_mm = span * 1000;
  const delta_immediate = calculateDeflection(L_mm, w_serv, Ec, Ie);
  const lambda = includeTopBars ? 1.5 : 2.0;
  const delta_total = delta_immediate * lambda;
  const delta_limit = L_mm / memberType;
  
  drawDeflectionDiagram(span, delta_total, delta_limit, (delta_total / delta_limit) * 100);
  
  // Update 3D visualization
  const finalSpacing = (userSpacing > 0 && userSpacing <= (recommendedSpacing || 999)) ? userSpacing : (recommendedSpacing || 200);
  const topBars3D = includeTopBars ? { n: topBarsCount, dia: topBarDia } : null;
  update3DBeam(b, h, span, bestOption, topBars3D, stirrupDia, finalSpacing);
}

function performShearDesign(Vu, b, d, fc, fyStirrup, stirrupDia, stirrupLegs, userSpacing) {
  const shearResults = document.getElementById("shearResults");
  const lambda = 1.0;
  const Vc = 0.17 * lambda * Math.sqrt(fc) * b * d / 1000;
  const phiVc = phiShear * Vc;
  const needMinStirrups = Vu > 0.5 * phiVc;
  const stirrupArea = (Math.PI * stirrupDia * stirrupDia / 4) * stirrupLegs;
  
  let results = `═══════════════════════════════════════════
📐 SHEAR DESIGN SUMMARY
═══════════════════════════════════════════
Factored shear V_u     = ${Vu.toFixed(2)} kN
Concrete shear V_c     = ${Vc.toFixed(2)} kN
φV_c = ${phiVc.toFixed(2)} kN\n`;
  
  let status = "", recommendedSpacing = null;
  
  if (Vu <= phiVc) {
    results += `\n✅ Concrete alone resists shear\n`;
    if (needMinStirrups) {
      const s_max_min = Math.min(d / 2, 600);
      recommendedSpacing = s_max_min;
      results += `⚠️ Minimum stirrups required: @ ${s_max_min.toFixed(0)} mm c/c\n`;
      status = "warning";
    } else {
      results += `✅ No stirrups required by code\n`;
      status = "success";
      recommendedSpacing = Math.min(d / 2, 600);
    }
  } else {
    const Vs_required = (Vu / phiShear) - Vc;
    const Vs_max = 0.66 * Math.sqrt(fc) * b * d / 1000;
    
    if (Vs_required > Vs_max) {
      results += `\n❌ SHEAR FAILURE! Increase beam dimensions.\n`;
      status = "error";
    } else {
      const s_required = (stirrupArea * fyStirrup * d / 1000) / Vs_required;
      let s_max = (Vs_required <= 0.33 * Math.sqrt(fc) * b * d / 1000) ? Math.min(d / 2, 600) : Math.min(d / 4, 300);
      recommendedSpacing = Math.min(s_required, s_max);
      
      results += `\n⚠️ STIRRUPS REQUIRED
Required Vs = ${Vs_required.toFixed(2)} kN
Required spacing = ${s_required.toFixed(0)} mm
Max spacing = ${s_max.toFixed(0)} mm
RECOMMENDED = ${recommendedSpacing.toFixed(0)} mm c/c\n`;
      status = "warning";
      
      if (!isNaN(userSpacing) && userSpacing > 0) {
        if (userSpacing <= recommendedSpacing) {
          results += `✅ User spacing (${userSpacing} mm) ACCEPTABLE\n`;
        } else {
          results += `❌ User spacing (${userSpacing} mm) NOT ACCEPTABLE\n`;
        }
      }
    }
  }
  
  const statusClass = status === "success" ? "success" : (status === "warning" ? "warning" : "error");
  const statusText = status === "success" ? "✓ SAFE" : (status === "warning" ? "⚠️ STIRRUPS NEEDED" : "❌ FAILURE");
  results += `\n📊 STATUS: <span class="${statusClass}">${statusText}</span>`;
  shearResults.innerHTML = results;
  return recommendedSpacing;
}

function drawShearMoment(L, wu, Vu, b, h, cover, fc) {
  const s = document.getElementById("shearCanvas").getContext("2d");
  const m = document.getElementById("momentCanvas").getContext("2d");
  s.clearRect(0, 0, s.canvas.width, s.canvas.height);
  m.clearRect(0, 0, m.canvas.width, m.canvas.height);
  
  const R = wu * L / 2;
  const points = 60;
  let Vmax = 0, Mmax = 0;
  const xs = [], Vs = [], Ms = [];
  for (let i = 0; i <= points; i++) {
    const x = L * i / points;
    const V = R - wu * x;
    const M = R * x - wu * x * x / 2;
    xs.push(x); Vs.push(V); Ms.push(M);
    Vmax = Math.max(Vmax, Math.abs(V));
    Mmax = Math.max(Mmax, Math.abs(M));
  }
  
  function drawDiagram(ctx, xs, ys, L, ymax, label, color) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (ymax === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const xPix = (xs[i] / L) * (w - 60) + 30;
      const yPix = h / 2 - (ys[i] / ymax) * (h / 2 - 25);
      if (i === 0) ctx.moveTo(xPix, yPix);
      else ctx.lineTo(xPix, yPix);
    }
    ctx.stroke();
    ctx.strokeStyle = "#6b7280";
    ctx.beginPath();
    ctx.moveTo(30, h / 2);
    ctx.lineTo(w - 30, h / 2);
    ctx.stroke();
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "10px system-ui";
    ctx.fillText(label, 10, 15);
    ctx.fillText(`max = ${ymax.toFixed(1)}`, w - 80, 15);
  }
  
  drawDiagram(s, xs, Vs, L, Vmax, "Shear V (kN)", "#f97316");
  drawDiagram(m, xs, Ms, L, Mmax, "Moment M (kN·m)", "#4ade80");
  
  const stirrupDia = parseFloat(document.getElementById("stirrupDia").value) || 8;
  const d = h - cover - stirrupDia - 16;
  const Vc = 0.17 * Math.sqrt(fc) * b * d / 1000;
  const phiVc = 0.75 * Vc;
  
  if (phiVc > 0 && Vmax > 0) {
    const yPix = s.canvas.height / 2 - (phiVc / Vmax) * (s.canvas.height / 2 - 25);
    if (yPix > 10 && yPix < s.canvas.height - 10) {
      s.beginPath();
      s.strokeStyle = "#fbbf24";
      s.lineWidth = 2;
      s.setLineDash([8, 6]);
      s.moveTo(30, yPix);
      s.lineTo(s.canvas.width - 30, yPix);
      s.stroke();
      s.setLineDash([]);
      s.fillStyle = "#fbbf24";
      s.font = "8px system-ui";
      s.fillText(`φVc = ${phiVc.toFixed(1)} kN`, s.canvas.width - 100, yPix - 3);
    }
  }
}

function drawDeflectionDiagram(L_m, delta_actual, delta_limit, ratioPercent) {
  const canvas = document.getElementById("deflectionCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  
  const margin = { left: 40, right: 30, top: 20, bottom: 30 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;
  const baselineY = margin.top + plotH;
  
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "9px system-ui";
  ctx.fillText("Deflected shape (exaggerated)", margin.left, margin.top - 5);
  
  ctx.beginPath();
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 1;
  ctx.moveTo(margin.left, baselineY);
  ctx.lineTo(w - margin.right, baselineY);
  ctx.stroke();
  
  const scaleY = Math.min(plotH * 0.4, (delta_actual / delta_limit) * plotH * 0.8);
  const points = 40;
  ctx.beginPath();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.5;
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * L_m * 1000;
    const xNorm = x / (L_m * 1000);
    const xPix = margin.left + xNorm * plotW;
    const deflection = (4 * delta_actual) * xNorm * (1 - xNorm);
    const yPix = baselineY - Math.min(deflection * 3, scaleY);
    if (i === 0) ctx.moveTo(xPix, yPix);
    else ctx.lineTo(xPix, yPix);
  }
  ctx.stroke();
  
  ctx.fillStyle = "#f87171";
  ctx.beginPath();
  ctx.arc(margin.left + plotW / 2, baselineY - Math.min(delta_actual * 3, scaleY), 4, 0, 2 * Math.PI);
  ctx.fill();
  
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "8px system-ui";
  ctx.fillText(`Δmax = ${delta_actual.toFixed(1)} mm`, margin.left + plotW / 2 - 30, baselineY - Math.min(delta_actual * 3, scaleY) - 5);
  ctx.fillStyle = "#6b7280";
  ctx.fillText(`Limit = ${delta_limit.toFixed(1)} mm`, margin.left + plotW / 2 + 10, baselineY - 5);
  
  const statusEl = document.getElementById("deflectionStatus");
  const barEl = document.getElementById("deflectionBar");
  const ratioEl = document.getElementById("deflectionRatio");
  
  if (delta_actual <= delta_limit) {
    statusEl.className = "deflection-status pass";
    statusEl.innerHTML = `✅ DEFLECTION OK: Δ = ${delta_actual.toFixed(1)} mm ≤ ${delta_limit.toFixed(1)} mm (L/${(L_m * 1000 / delta_limit).toFixed(0)})`;
  } else {
    statusEl.className = "deflection-status fail";
    statusEl.innerHTML = `❌ DEFLECTION EXCEEDS LIMIT: Δ = ${delta_actual.toFixed(1)} mm > ${delta_limit.toFixed(1)} mm 💡 Increase depth or add top bars`;
  }
  
  const fillPercent = Math.min(100, (delta_actual / delta_limit) * 100);
  barEl.style.width = `${fillPercent}%`;
  ratioEl.innerHTML = `${fillPercent.toFixed(0)}%`;
}

function drawSection(b, h, cover, bars, includeTopBars, topBarDia, topBarsCount) {
  const canvas = document.getElementById("sectionCanvas");
  const ctx = canvas.getContext("2d");
  const stirrupDia = parseFloat(document.getElementById("stirrupDia").value) || 8;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  
  const margin = 20;
  const scale = Math.min((W - 2 * margin) / b, (H - 2 * margin) / h);
  const bw = b * scale;
  const bh = h * scale;
  const x0 = (W - bw) / 2;
  const y0 = (H - bh) / 2;
  
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, bw, bh);
  
  ctx.beginPath();
  ctx.setLineDash([5, 7]);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1.5;
  const coverPx = cover * scale;
  ctx.strokeRect(x0 + coverPx / 2, y0 + coverPx / 2, bw - coverPx, bh - coverPx);
  ctx.setLineDash([]);
  
  if (!bars) return;
  
  const barDiaPix = bars.dia * scale;
  const n = bars.n;
  const usableWidth = bw - 2 * coverPx;
  const totalBarsWidth = n * barDiaPix;
  const spacing = n > 1 ? (usableWidth - totalBarsWidth) / (n - 1) : 0;
  let x = x0 + coverPx + barDiaPix / 2;
  const y = y0 + bh - coverPx - barDiaPix / 2;
  
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(x, y, barDiaPix / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#f97316";
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `${Math.max(8, barDiaPix / 2.5)}px system-ui`;
    ctx.fillText(`${bars.dia}`, x - 4, y + 4);
    x += barDiaPix + spacing;
  }
  
  if (includeTopBars && topBarDia && topBarsCount) {
    const topBarDiaPix = topBarDia * scale;
    const y_top = y0 + coverPx + topBarDiaPix / 2;
    let x_top = x0 + coverPx + topBarDiaPix / 2;
    const topSpacing = topBarsCount > 1 ? (usableWidth - topBarsCount * topBarDiaPix) / (topBarsCount - 1) : 0;
    for (let i = 0; i < topBarsCount; i++) {
      ctx.beginPath();
      ctx.arc(x_top, y_top, topBarDiaPix / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#60a5fa";
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = `${Math.max(8, topBarDiaPix / 2.5)}px system-ui`;
      ctx.fillText(`${topBarDia}`, x_top - 4, y_top + 4);
      x_top += topBarDiaPix + topSpacing;
    }
  }
  
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 9px system-ui";
  ctx.fillText(`${bars.n} Ø${bars.dia} (bottom)`, x0 + 6, y0 + 18);
  if (includeTopBars && topBarsCount) {
    ctx.fillStyle = "#60a5fa";
    ctx.fillText(`${topBarsCount} Ø${topBarDia} (top)`, x0 + 6, y0 + 34);
  }
}

function displayAlternatives(options, bestOption) {
  const container = document.getElementById("alternativesList");
  if (!container) return;
  container.innerHTML = "";
  options.slice(0, 15).forEach(opt => {
    const card = document.createElement("div");
    card.className = "alternative-card";
    if (bestOption && opt.dia === bestOption.dia && opt.n === bestOption.n) card.classList.add("selected");
    card.innerHTML = `
      <h3>${opt.n} × Ø${opt.dia} mm (${opt.diaName})</h3>
      <p><strong>As</strong> = ${opt.As.toFixed(0)} mm² | <strong>φMₙ</strong> = ${opt.phiMn.toFixed(1)} kN·m</p>
      <p><strong>Utilization</strong> = ${(opt.efficiency * 100).toFixed(1)}% | <strong>Region:</strong> ${opt.region}</p>
      <p class="efficiency">${opt === bestOption ? "🏆 BEST OPTION" : "✓ Alternative"}</p>`;
    card.onclick = () => {
      const b = parseFloat(document.getElementById("b").value);
      const h = parseFloat(document.getElementById("h").value);
      const cover = parseFloat(document.getElementById("cover").value);
      const includeTop = document.getElementById("includeTopBars").checked;
      const topDia = includeTop ? parseFloat(document.getElementById("topBarDia").value) : 0;
      const topCount = includeTop ? parseFloat(document.getElementById("topBarsCount").value) : 0;
      drawSection(b, h, cover, opt, includeTop, topDia, topCount);
      document.getElementById("bestOptionLabel").innerHTML = `📌 Selected: ${opt.n} × Ø${opt.dia}mm | As = ${opt.As.toFixed(0)} mm² | φMn = ${opt.phiMn.toFixed(1)} kN·m`;
      document.getElementById("bestOptionLabel").classList.add("active");
      document.querySelectorAll(".alternative-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      
      // Update 3D view when alternative is selected
      const stirrupDia = parseFloat(document.getElementById("stirrupDia").value);
      const userSpacing = parseFloat(document.getElementById("stirrupSpacing").value);
      const includeTopBarsNow = document.getElementById("includeTopBars").checked;
      const topBarDiaNow = includeTopBarsNow ? parseFloat(document.getElementById("topBarDia").value) : 0;
      const topBarsCountNow = includeTopBarsNow ? parseFloat(document.getElementById("topBarsCount").value) : 0;
      const span = parseFloat(document.getElementById("span").value);
      const recommendedSpacing = 200;
      const finalSpacing = (userSpacing > 0) ? userSpacing : recommendedSpacing;
      const topBars3D = includeTopBarsNow ? { n: topBarsCountNow, dia: topBarDiaNow } : null;
      update3DBeam(b, h, span, opt, topBars3D, stirrupDia, finalSpacing);
    };
    container.appendChild(card);
  });
}

function displayAllDiameters(Mu, b, d, fc, fy) {
  const container = document.getElementById("allDiametersList");
  if (!container) return;
  container.innerHTML = "";
  for (const [dia, bar] of Object.entries(barDatabase)) {
    let bestCombination = null;
    for (let n = 1; n <= 8; n++) {
      const As = n * bar.area;
      const Mn = computeMn(As, b, d, fc, fy);
      const phiMn = phiFlexure * Mn;
      if (phiMn >= Mu) {
        if (!bestCombination || phiMn > bestCombination.phiMn) bestCombination = { n, As, phiMn };
      }
    }
    const card = document.createElement("div");
    card.className = "diameter-card";
    card.innerHTML = `
      <h3>Ø${bar.dia} mm — ${bar.name}</h3>
      <p><strong>Area:</strong> ${bar.area.toFixed(1)} mm² | <strong>Region:</strong> ${bar.region}</p>
      ${bestCombination ? `
        <p class="available">✓ AVAILABLE</p>
        <p>Best: ${bestCombination.n} bars → As = ${bestCombination.As.toFixed(0)} mm²</p>
        <div class="best-match">✓ Can be used</div>
      ` : `<p class="not-available">✗ NOT SUFFICIENT</p>`}`;
    container.appendChild(card);
  }
  const noteDiv = document.createElement("div");
  noteDiv.className = "note-box";
  noteDiv.innerHTML = `<strong>📌 INTERNATIONAL BAR DIAMETERS:</strong><br>• USA/Canada: 10,13,16,19,22,25,29,32,36,43 mm<br>• Europe/Asia: 10,12,14,16,18,20,22,25,28,32,36,40 mm<br>• Middle East: 10,12,14,16,18,20,25,32 mm`;
  container.appendChild(noteDiv);
}

function drawEmptyState() {
  const canvas = document.getElementById("sectionCanvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("No data", canvas.width/2 - 25, canvas.height/2);
  }
  document.getElementById("alternativesList").innerHTML = '<div class="placeholder-full">Enter values to see viable reinforcement options</div>';
  document.getElementById("allDiametersList").innerHTML = '<div class="placeholder-full">Enter values to see which bar diameters work</div>';
  document.getElementById("shearResults").innerHTML = '<div class="placeholder-full">Enter values to see shear design results</div>';
  document.getElementById("bestOptionLabel").innerHTML = "Waiting for input...";
  document.getElementById("bestOptionLabel").classList.remove("active");
  document.getElementById("outputFlexure").innerHTML = 'Enter values and click "Design Beam" to see flexural results.';
  document.getElementById("deflectionStatus").className = "deflection-status waiting";
  document.getElementById("deflectionStatus").innerHTML = "Waiting for input...";
  document.getElementById("deflectionBar").style.width = "0%";
  document.getElementById("deflectionRatio").innerHTML = "0%";
}

function resetForm() {
  document.getElementById("span").value = "";
  document.getElementById("wD").value = "";
  document.getElementById("wL").value = "";
  document.getElementById("b").value = "";
  document.getElementById("h").value = "";
  document.getElementById("cover").value = "";
  document.getElementById("fc").value = "";
  document.getElementById("fy").value = "";
  document.getElementById("fyStirrup").value = "420";
  document.getElementById("stirrupDia").value = "8";
  document.getElementById("stirrupLegs").value = "2";
  document.getElementById("stirrupSpacing").value = "";
  document.getElementById("memberType").value = "360";
  document.getElementById("includeSelfWeight").checked = true;
  document.getElementById("includeTopBars").checked = false;
  document.getElementById("topBarsInputs").style.display = "none";
  document.getElementById("error").textContent = "";
  drawEmptyState();
  const shearCanvas = document.getElementById("shearCanvas");
  const momentCanvas = document.getElementById("momentCanvas");
  const deflectionCanvas = document.getElementById("deflectionCanvas");
  if (shearCanvas) {
    const ctx = shearCanvas.getContext("2d");
    ctx.clearRect(0, 0, shearCanvas.width, shearCanvas.height);
  }
  if (momentCanvas) {
    const ctx = momentCanvas.getContext("2d");
    ctx.clearRect(0, 0, momentCanvas.width, momentCanvas.height);
  }
  if (deflectionCanvas) {
    const ctx = deflectionCanvas.getContext("2d");
    ctx.clearRect(0, 0, deflectionCanvas.width, deflectionCanvas.height);
  }
  if (currentBeamGroup && scene) {
    scene.remove(currentBeamGroup);
    currentBeamGroup = null;
  }
}

document.getElementById("includeTopBars").addEventListener("change", toggleTopBars);
window.addEventListener("DOMContentLoaded", () => {
  toggleTopBars();
  drawEmptyState();
  init3D();
});
// ========== OPTIMIZATION FUNCTIONS (Add at the end of app.js) ==========

function suggestOptimalDimensions() {
  const span = parseFloat(document.getElementById("span").value);
  const wD = parseFloat(document.getElementById("wD").value);
  const wL = parseFloat(document.getElementById("wL").value);
  const fc = parseFloat(document.getElementById("fc").value);
  const fy = parseFloat(document.getElementById("fy").value);
  const cover = parseFloat(document.getElementById("cover").value);
  const stirrupDia = parseFloat(document.getElementById("stirrupDia").value);
  
  if ([span, wD, wL, fc, fy].some(v => isNaN(v) || v <= 0)) {
    showToastSuggestion("❌ Please enter span, loads, fc, and fy first!", "error");
    return;
  }
  
  const optBtn = document.querySelector('.optimize-btn');
  optBtn.classList.add('loading');
  optBtn.disabled = true;
  
  setTimeout(() => {
    try {
      const optimal = findOptimalDimensions(span, wD, wL, fc, fy, cover, stirrupDia);
      document.getElementById("b").value = optimal.b;
      document.getElementById("h").value = optimal.h;
      showToastSuggestion(`✨ Optimal dimensions found: ${optimal.b}×${optimal.h} mm`, "success", () => runDesign());
    } catch (error) {
      showToastSuggestion("⚠️ Could not find optimal dimensions. Try different values.", "error");
    } finally {
      optBtn.classList.remove('loading');
      optBtn.disabled = false;
    }
  }, 100);
}

function findOptimalDimensions(span, wD, wL, fc, fy, cover, stirrupDia) {
  let bestDesign = null;
  let bestUtilization = Infinity;  // We want closest to 100% but not over
  let bestB = 300;
  let bestH = 500;
  
  const bRange = [200, 230, 250, 280, 300, 320, 350, 380, 400, 420, 450, 480, 500];
  const hRange = [300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800];
  
  for (const b of bRange) {
    for (const h of hRange) {
      // Skip unrealistic proportions (beam should be deeper than wide)
      if (h < b) continue;
      
      const d = h - cover - stirrupDia - 16;
      if (d <= 0.2 * h) continue;
      
      const wu = 1.2 * wD + 1.6 * wL;
      const Mu = wu * span * span / 8;
      const requiredAs = solveRequiredSteel(Mu, b, d, fc, fy);
      
      if (!requiredAs || requiredAs <= 0) continue;
      
      const bars = findFeasibleBars(requiredAs, b, cover);
      if (!bars) continue;
      
      // Check shear
      const Vu = wu * span / 2;
      const Vc = 0.17 * Math.sqrt(fc) * b * d / 1000;
      const phiVc = 0.75 * Vc;
      let shearOk = true;
      
      if (Vu > phiVc) {
        const stirrupArea = (Math.PI * stirrupDia * stirrupDia / 4) * 2;
        const Vs_required = (Vu / 0.75) - Vc;
        if (Vs_required > 0) {
          const requiredSpacing = (stirrupArea * fy * d / 1000) / Vs_required;
          if (requiredSpacing < 50) shearOk = false;
        }
      }
      
      if (!shearOk) continue;
      
      // Calculate utilization (closer to 1.0 is better, but not over)
      const Mn = computeMn(bars.As, b, d, fc, fy);
      const phiMn = 0.9 * Mn;
      const utilization = Mu / phiMn;
      
      // We want utilization as close to 1.0 as possible, but not exceeding 1.0
      if (utilization <= 1.0 && utilization > 0.7) {
        const distanceFromOptimal = Math.abs(1.0 - utilization);
        
        if (distanceFromOptimal < bestUtilization) {
          bestUtilization = distanceFromOptimal;
          bestB = b;
          bestH = h;
          bestDesign = { b: b, h: h, utilization: utilization };
        }
      }
    }
  }
  
  // If no design found within 70-100% utilization, return the closest
  if (!bestDesign) {
    bestB = Math.max(250, Math.round(span * 60));
    bestH = Math.max(400, Math.round(span * 90));
  }
  
  return { b: bestB, h: bestH };
}

function findFeasibleBars(requiredAs, b, cover) {
  const barAreas = { 
    10: 78.5, 12: 113.1, 14: 153.9, 16: 201.1, 
    18: 254.5, 20: 314.2, 22: 380.1, 25: 490.9, 
    28: 615.8, 32: 804.2 
  };
  let best = null;
  let bestDiff = Infinity;
  
  for (const [dia, area] of Object.entries(barAreas)) {
    for (let n = 2; n <= 6; n++) {
      const As = n * area;
      if (As < requiredAs * 0.9) continue;
      
      const minSpacing = Math.max(25, parseInt(dia));
      const availableWidth = b - 2 * cover - 20;
      const requiredWidth = n * parseInt(dia) + (n - 1) * minSpacing;
      if (requiredWidth > availableWidth) continue;
      
      const diff = As - requiredAs;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = { n: n, dia: parseInt(dia), As: As };
      }
    }
  }
  return best;
}

function showToastSuggestion(message, type = "success", onConfirm = null) {
  const existingToasts = document.querySelectorAll('.toast-suggestion');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = 'toast-suggestion';
  const icon = type === "success" ? "✨" : "⚠️";
  
  toast.innerHTML = `
    <span>${icon} ${message}</span>
    ${onConfirm ? '<button onclick="this.closest(\'.toast-suggestion\').remove(); document.querySelector(\'.optimize-btn\').scrollIntoView();">OK</button>' : ''}
    <button onclick="this.closest(\'.toast-suggestion\').remove()">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}