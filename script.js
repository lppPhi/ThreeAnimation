import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import anime from 'animejs';
// Đã sửa dòng import simplex-noise: thử import default export
import SimplexNoise from 'simplex-noise';

// Khai báo biến noise3D và noise4D ở đầu file
// Chúng sẽ được gán giá trị (các hàm tạo noise) trong hàm init()
let noise3D, noise4D;


let scene, camera, renderer, controls, clock;
let composer, bloomPass;

let particlesGeometry, particlesMaterial, particleSystem;
// currentPositions lưu trữ vị trí hiện tại của các hạt trong mỗi frame
// sourcePositions lưu trữ vị trí bắt đầu của các hạt cho animation morphing hoặc idle
let currentPositions, sourcePositions;
// Biến toàn cục để lưu trữ dữ liệu đích hiện tại (vị trí và màu sắc) từ ảnh
let currentTargetPositions = null;
let currentTargetColors = null;
// Lưu trữ dữ liệu mặc định (Vinamilk) để quay lại
let defaultTargetPositions = null;
let defaultTargetColors = null;

let morphTimeline = null;
// isMorphing: cờ báo hiệu có đang trong quá trình morphing hay không
let isMorphing = false;

const CONFIG = {
    particleCount: 0, // Sẽ được xác định dựa trên số pixel opacity > 128 của hình ảnh Vinamilk ban đầu
    initialShapeSize: 8, // Kích thước khối ngẫu nhiên ban đầu
    swarmDistanceFactor: 1.5, // Hệ số ảnh hưởng của swarm position
    swirlFactor: 2.0, // Độ mạnh của hiệu ứng xoáy trong lúc morphing
    noiseFrequency: 0.15, // Tần suất của Simplex Noise
    noiseTimeScale: 0.03, // Tốc độ thay đổi của Simplex Noise theo thời gian
    noiseMaxStrength: 1.5, // Độ mạnh tối đa của Simplex Noise trong lúc morphing
    morphDuration: 3000, // Thời gian animation morphing (miliseconds)
    particleSizeRange: [0.05, 0.15], // Khoảng kích thước ngẫu nhiên của hạt
    starCount: 5000, // Số lượng sao trong nền
    bloomStrength: 0.8, // Cường độ hiệu ứng Bloom
    bloomRadius: 0.4, // Bán kính hiệu ứng Bloom
    bloomThreshold: 0.1, // Ngưỡng độ sáng để áp dụng Bloom
    idleFlowStrength: 0.15, // Độ mạnh của hiệu ứng chảy nhiễu khi idle
    idleFlowSpeed: 0.05, // Tốc độ của hiệu ứng chảy nhiễu khi idle
    idleRotationSpeed: 0.01, // Tốc độ tự động xoay camera khi idle (không dùng autoRotate của controls)
    morphSizeFactor: 0.3, // Hệ số giảm kích thước hạt khi hiệu ứng morphing mạnh
    morphBrightnessFactor: 0.4, // Hệ số tăng độ sáng hạt khi hiệu ứng morphing mạnh
    imageProcessingScale: 0.04 // Hệ số scale khi chuyển vị trí pixel ảnh sang không gian 3D
};

// morphState: đối tượng được animejs điều khiển để theo dõi tiến trình morph
const morphState = { progress: 0.0 };

// Các biến tạm để tránh tạo đối tượng mới trong vòng lặp animate/update
const tempVec = new THREE.Vector3();
const sourceVec = new THREE.Vector3(); // Vector tạm cho vị trí nguồn
const targetVec = new THREE.Vector3(); // Vector tạm cho vị trí đích
const swarmVec = new THREE.Vector3(); // Vector tạm cho vị trí swarm
const noiseOffset = new THREE.Vector3(); // Vector tạm cho offset từ noise
const flowVec = new THREE.Vector3(); // Vector tạm cho vector dòng chảy idle
const bezPos = new THREE.Vector3(); // Vector tạm cho vị trí trên đường cong Bezier
const swirlAxis = new THREE.Vector3(); // Vector tạm cho trục xoáy
const currentVec = new THREE.Vector3(); // Vector tạm cho vị trí hiện tại của hạt


// Hàm tạo vị trí ngẫu nhiên cho các hạt trong hình khối ban đầu
function generateCube(count, size) {
    const points = new Float32Array(count * 3);
    const halfSize = size / 2;
    for (let i = 0; i < count; i++) {
        const x = Math.random() * size - halfSize;
        const y = Math.random() * size - halfSize;
        const z = Math.random() * size - halfSize;
        points.set([x, y, z], i * 3);
    }
    return points;
}

// Hàm tạo texture ngôi sao tròn phát sáng
function createStarTexture() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

// Hàm tạo nền sao 3D tĩnh
function createStarfield() {
    const starVertices = [];
    const starSizes = [];
    const starColors = [];
    const starGeometry = new THREE.BufferGeometry();
    for (let i = 0; i < CONFIG.starCount; i++) {
        tempVec.set( THREE.MathUtils.randFloatSpread(200), THREE.MathUtils.randFloatSpread(200), THREE.MathUtils.randFloatSpread(200) );
        // Đảm bảo sao ở xa trung tâm hơn một khoảng nhất định
        if (tempVec.length() < 50) tempVec.setLength(50 + Math.random() * 150);
        starVertices.push(tempVec.x, tempVec.y, tempVec.z);
        starSizes.push(Math.random() * 0.1 + 0.05); // Kích thước ngẫu nhiên
        const color = new THREE.Color(0xffffff);
        color.multiplyScalar(0.5 + Math.random() * 0.5); // Màu sắc ngẫu nhiên
        starColors.push(color.r, color.g, color.b);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
    starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));
    const starMaterial = new THREE.ShaderMaterial({
         uniforms: { pointTexture: { value: createStarTexture() } },
         vertexShader: `
              attribute float size; varying vec3 vColor; varying float vSize;
              void main() {
                   vColor = color; vSize = size; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                   // Tính gl_PointSize dựa trên kích thước hạt và khoảng cách đến camera
                   gl_PointSize = size * (200.0 / -mvPosition.z);
                   gl_Position = projectionMatrix * mvPosition;
              }`,
         fragmentShader: `
              uniform sampler2D pointTexture; varying vec3 vColor; varying float vSize;
              void main() {
                   // Lấy alpha từ texture ngôi sao
                   float alpha = texture2D(pointTexture, gl_PointCoord).a;
                   if (alpha < 0.1) discard; // Loại bỏ các phần trong suốt
                   // Màu cuối cùng là màu hạt nhân với alpha từ texture
                   gl_FragColor = vec4(vColor, alpha * 0.9);
              }`,
         blending: THREE.AdditiveBlending, // Cộng màu sắc để tạo hiệu ứng phát sáng
         depthWrite: false, // Không ghi vào depth buffer để các hạt có thể blend đúng
         transparent: true,
         vertexColors: true // Cho phép sử dụng màu sắc từ attribute
     });
    scene.add(new THREE.Points(starGeometry, starMaterial)); // Thêm nền sao vào scene
}

// Hàm tải dữ liệu hình ảnh từ URL (được giữ lại cho ảnh Vinamilk ban đầu)
async function loadImageData(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            resolve(imageData);
        };
        img.onerror = (error) => {
             console.error("Error loading image:", url, error);
             reject(error);
        };
        img.src = url;
        // Cần crossorigin='anonymous' nếu load ảnh từ nguồn khác domain và cần pixel data
        img.crossOrigin = 'anonymous';
    });
}

// Hàm xử lý dữ liệu hình ảnh để lấy MẪU pixel làm vị trí và màu đích cho số lượng hạt cố định
function sampleImagePixels(imageData, count, scale) {
    const pixelData = [];
    const width = imageData.width;
    const height = imageData.height;

    // Thu thập tất cả các pixel "hợp lệ" (alpha > 128)
    for (let i = 0; i < imageData.data.length; i += 4) {
        const a = imageData.data [i + 3];
        if (a > 128) {
            const index = i / 4;
            const x = (index % width) - width / 2; // Tọa độ x tâm giữa ảnh
            const y = height / 2 - Math.floor(index / width); // Tọa độ y tâm giữa ảnh (ảnh gốc có y dương hướng xuống)
            const z = 0; // Giữ nguyên z = 0 cho ảnh 2D

            const r = imageData.data [i];
            const g = imageData.data [i + 1];
            const b = imageData.data [i + 2];

            pixelData.push({
                position: new THREE.Vector3(x * scale, y * scale, z),
                color: new THREE.Color(`rgb(${r},${g},${b})`)
            });
        }
    }

    // Nếu số lượng pixel hợp lệ ít hơn số hạt, lặp lại dữ liệu hoặc thêm điểm ngẫu nhiên
    // Điều này đảm bảo luôn có đủ điểm đích cho tất cả các hạt
    // Lặp lại dữ liệu có thể tạo ra một số điểm trùng lặp vị trí, nhưng vẫn tốt hơn thiếu điểm.
    while (pixelData.length < count) {
         const randomIndex = Math.floor(Math.random() * pixelData.length);
         if (pixelData.length > 0) {
             // Sao chép một pixel ngẫu nhiên để lấp đầy
             pixelData.push({...pixelData[randomIndex]});
         } else {
             // Trường hợp ảnh rỗng hoặc không có pixel có alpha > 128
             // Thêm điểm ngẫu nhiên trong một không gian nhỏ và màu trắng
             pixelData.push({
                 position: new THREE.Vector3(THREE.MathUtils.randFloatSpread(CONFIG.initialShapeSize*0.5), THREE.MathUtils.randFloatSpread(CONFIG.initialShapeSize*0.5), THREE.MathUtils.randFloatSpread(CONFIG.initialShapeSize*0.5)),
                 color: new THREE.Color(0xffffff) // Màu trắng mặc định
             });
         }
    }


    // Nếu số lượng pixel hợp lệ nhiều hơn số hạt, lấy mẫu ngẫu nhiên
    const sampledPixels = [];
    if (pixelData.length > count) {
        // Lấy ngẫu nhiên 'count' chỉ mục duy nhất
        const indices = new Set();
        while (indices.size < count) {
            indices.add(Math.floor(Math.random() * pixelData.length));
        }
        indices.forEach(index => sampledPixels.push(pixelData [index]));
    } else {
        // Sử dụng tất cả nếu ít hơn hoặc bằng (và đã được đảm bảo đủ số lượng bằng vòng lặp while ở trên)
        sampledPixels.push(...pixelData);
    }

     // Xáo trộn mảng sampledPixels để các hạt ngẫu nhiên chuyển đến các vị trí đích ngẫu nhiên trong ảnh mới
    // Điều này giúp tránh các pattern không mong muốn khi morph giữa các ảnh có cấu trúc khác nhau
    // và làm cho hiệu ứng phân tán/gom lại tự nhiên hơn.
    for (let i = sampledPixels.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sampledPixels[i], sampledPixels[j]] = [sampledPixels[j], sampledPixels[i]];
    }


    // Tạo Float32Array cho vị trí và màu sắc đích cuối cùng
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        positions [i * 3] = sampledPixels [i].position.x;
        positions [i * 3 + 1] = sampledPixels [i].position.y;
        positions [i * 3 + 2] = sampledPixels [i].position.z;

        colors [i * 3] = sampledPixels [i].color.r;
        colors [i * 3 + 1] = sampledPixels [i].color.g;
        colors [i * 3 + 2] = sampledPixels [i].color.b;
    }

    return { positions, colors };
}


// Hàm thiết lập hệ thống hạt lần đầu (dùng ảnh Vinamilk để xác định số hạt)
// Hàm này giờ trả về Promise của animation morphing ban đầu để init có thể await
async function setupParticleSystem() {
    const loadingSpan = document.querySelector('#loading span');
    const progressBar = document.getElementById('progress');
    let progress = 0;
    const updateProgress = (inc, message) => {
        progress += inc;
        progressBar.style.width = `${Math.min(100, progress)}%`;
        if (message) loadingSpan.innerText = message;
    };

    updateProgress(10, 'Loading default logo...');
    try {
        const logoImageData = await loadImageData('vinamilk.png');

        // Tạm thời lấy hết pixel có alpha > 128 để đếm số lượng hợp lệ ban đầu
        const tempPixelCount = logoImageData.data.reduce((count, value, index, arr) => {
             // Chỉ kiểm tra kênh alpha (mỗi 4 phần tử)
             if ((index + 1) % 4 === 0 && value > 128) {
                 return count + 1;
             }
             return count;
        }, 0);

        CONFIG.particleCount = tempPixelCount; // Số hạt dựa trên số pixel opacity > 128 của ảnh Vinamilk
        console.log(`Particle count determined from Vinamilk logo: ${CONFIG.particleCount}`);
        if (CONFIG.particleCount === 0) {
             console.warn("No visible pixels found in the default logo image.");
             // Có thể đặt một số hạt mặc định nếu ảnh logo rỗng
             CONFIG.particleCount = 5000; // Đặt số hạt cố định
              const dummyTargetData = sampleImagePixels({ data: [], width: 0, height: 0 }, CONFIG.particleCount, CONFIG.imageProcessingScale);
              defaultTargetPositions = dummyTargetData.positions;
              defaultTargetColors = dummyTargetData.colors;
              currentTargetPositions = defaultTargetPositions;
              currentTargetColors = defaultTargetColors;

        } else {
            // Lấy mẫu lại chỉ với số hạt đã xác định từ ảnh Vinamilk
            const vinamilkTargetData = sampleImagePixels(logoImageData, CONFIG.particleCount, CONFIG.imageProcessingScale);
            defaultTargetPositions = vinamilkTargetData.positions;
            defaultTargetColors = vinamilkTargetData.colors;
            currentTargetPositions = defaultTargetPositions; // Mục tiêu ban đầu là Vinamilk
            currentTargetColors = defaultTargetColors; // Màu sắc ban đầu là Vinamilk
        }


        particlesGeometry = new THREE.BufferGeometry();

        // Vị trí ban đầu là khối ngẫu nhiên
        sourcePositions = generateCube(CONFIG.particleCount, CONFIG.initialShapeSize);
        // currentPositions được sử dụng trong animate loop để lưu vị trí thực tế của hạt sau khi áp dụng noise/flow
        // Nó bắt đầu từ sourcePositions
        currentPositions = new Float32Array(sourcePositions);
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));

        // Thiết lập màu sắc ban đầu dựa trên màu đích của Vinamilk
        particlesGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(currentTargetColors), 3));

        // Khởi tạo các attribute khác cho hạt
        let particleSizes = new Float32Array(CONFIG.particleCount);
        let particleOpacities = new Float32Array(CONFIG.particleCount); // Biến cục bộ cho opacity
        let particleEffectStrengths = new Float32Array(CONFIG.particleCount); // Biến cục bộ cho effectStrength

        for (let i = 0; i < CONFIG.particleCount; i++) {
            particleSizes [i] = THREE.MathUtils.randFloat(CONFIG.particleSizeRange [0], CONFIG.particleSizeRange [1]);
            // Đặt opacity ban đầu bằng 0 để hạt xuất hiện dần trong quá trình morphing ban đầu
            particleOpacities [i] = 0.0;
            particleEffectStrengths [i] = 0.0; // Ban đầu không có hiệu ứng
        }
         // Gán các mảng cục bộ vào attribute của geometry
        particlesGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));
        particlesGeometry.setAttribute('opacity', new THREE.BufferAttribute(particleOpacities, 1)); // Cần attribute opacity
        particlesGeometry.setAttribute('aEffectStrength', new THREE.BufferAttribute(particleEffectStrengths, 1));


        // Tạo Shader Material cho hạt
        particlesMaterial = new THREE.ShaderMaterial({
             uniforms: {
                  pointTexture: { value: createStarTexture() }
             },
             vertexShader: `
                  attribute float size;
                  attribute float opacity; // Nhận opacity từ attribute
                  attribute float aEffectStrength;
                  varying vec3 vColor;
                  varying float vOpacity; // Truyền opacity sang fragment shader
                  varying float vEffectStrength;

                  void main() {
                       vColor = color;
                       vOpacity = opacity; // Sử dụng opacity từ attribute
                       vEffectStrength = aEffectStrength;

                       vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                       // Điều chỉnh kích thước hạt trong quá trình morphing
                       float sizeScale = 1.0 - vEffectStrength * ${CONFIG.morphSizeFactor.toFixed(2)};
                       gl_PointSize = size * sizeScale * (200.0 / -mvPosition.z);

                       gl_Position = projectionMatrix * mvPosition;
                  }
             `,
             fragmentShader: `
                  uniform sampler2D pointTexture;
                  varying vec3 vColor;
                  varying float vOpacity; // Nhận opacity từ vertex shader
                  varying float vEffectStrength;

                  void main() {
                       float alpha = texture2D(pointTexture, gl_PointCoord).a;
                       if (alpha < 0.05) discard; // Loại bỏ các phần trong suốt

                       // Làm sáng màu khi morphing
                       vec3 finalColor = vColor * (1.0 + vEffectStrength * ${CONFIG.morphBrightnessFactor.toFixed(2)});

                       // Kết hợp alpha từ texture và opacity từ attribute
                       gl_FragColor = vec4(finalColor, alpha * vOpacity);
                  }
             `,
             blending: THREE.AdditiveBlending,
             depthTest: true, // Kiểm tra chiều sâu để hạt phía sau bị che khuất
             depthWrite: false, // Không ghi vào depth buffer để các hạt có thể blend đúng
             transparent: true,
             vertexColors: true // Cho phép sử dụng màu sắc từ attribute
        });

        particleSystem = new THREE.Points(particlesGeometry, particlesMaterial);
        scene.add(particleSystem); // Thêm hệ thống hạt vào scene

        updateProgress(40, 'Initial Morphing...');

        // Kích hoạt animation morphing ban đầu và trả về promise của nó
        const initialMorphTimeline = triggerMorphToLogo();

        // Thêm animation cho opacity (fade-in) trong timeline morph ban đầu
        const opacityAttribute = particlesGeometry.attributes.opacity; // Lấy attribute opacity

        anime({
            targets: opacityAttribute.array, // Anime trực tiếp mảng của attribute
            value: 1.0, // Đi từ 0 đến 1
            duration: CONFIG.morphDuration * 0.8, // Thời gian animation opacity, có thể ngắn hơn morph vị trí
            easing: 'linear', // Hoặc easing khác
            delay: CONFIG.morphDuration * 0.2, // Bắt đầu trễ một chút sau khi morph vị trí bắt đầu
            update: () => {
                 opacityAttribute.needsUpdate = true; // Đánh dấu cần cập nhật attribute
            }
        });


        return initialMorphTimeline.finished; // Trả về Promise hoàn thành của animation morph vị trí

    } catch (e) {
        console.error('Particle system setup error:', e);
        // Ném lỗi để hàm init xử lý
        throw e;
    }
}

// Hàm xử lý file ảnh được chọn
function handleImageFileSelect(event) {
    const files = event.target.files;
    if (files.length === 0) {
        document.getElementById('info').innerText = `Choose Image`;
        document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
        return;
    }

    const file = files [0];
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file.');
        document.getElementById('info').innerText = `Choose Image`;
        document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
        return;
    }

    document.getElementById('info').innerText = `Loading "${file.name}"...`;
    document.getElementById('info').style.textShadow = '0 0 8px rgba(0, 102, 204, 0.9)';

    // Tạm dừng animation hiện tại nếu có
    if (morphTimeline) {
        morphTimeline.pause(); // Tạm dừng animation vị trí
        // Các animation opacity liên quan đến timeline này cũng sẽ dừng
    }
    isMorphing = true; // Set flag ngay khi bắt đầu load ảnh mới
    controls.autoRotate = false; // Tắt auto rotate

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Sử dụng canvas tạm để lấy ImageData
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);

            // Xử lý dữ liệu ảnh mới và cập nhật mục tiêu
            // Sử dụng CONFIG.particleCount đã được xác định ban đầu
            const newTargetData = sampleImagePixels(imageData, CONFIG.particleCount, CONFIG.imageProcessingScale);
            currentTargetPositions = newTargetData.positions;
            currentTargetColors = newTargetData.colors;

            // Cập nhật màu sắc hạt ngay lập tức
            if (particlesGeometry && particlesGeometry.attributes.color) {
                particlesGeometry.attributes.color.array.set(currentTargetColors);
                particlesGeometry.attributes.color.needsUpdate = true;
            }


            document.getElementById('info').innerText = `Morphing to "${file.name}"...`;

            // Kích hoạt animation morphing đến hình ảnh mới
            const newMorphTimeline = triggerMorphToLogo(file.name);

            // Animation cho opacity (fade-out rồi fade-in với màu mới)
            const opacityAttribute = particlesGeometry.attributes.opacity;
            if (opacityAttribute) { // Kiểm tra tồn tại attribute
                 anime({
                     targets: opacityAttribute.array, // Anime trực tiếp mảng của attribute
                     // Đi từ 1 (đang hiển thị) về 0 (ẩn đi) rồi quay lại 1
                     value: [
                          { value: 0.0, duration: CONFIG.morphDuration * 0.3, easing: 'easeOutQuad' },
                          { value: 1.0, duration: CONFIG.morphDuration * 0.7, easing: 'easeInQuad' }
                     ],
                     duration: CONFIG.morphDuration,
                     update: () => {
                          opacityAttribute.needsUpdate = true; // Đánh dấu cần cập nhật attribute
                     }
                 });
            }


             // Sử dụng promise.finished của anime timeline mới để biết khi nào morphing xong
            newMorphTimeline.finished.then(() => {
                 console.log(`Morphing to "${file.name}" complete.`);
                 document.getElementById('info').innerText = `${file.name} (Choose Image)`;
                 document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 180, 50, 0.8)';
                 document.getElementById('fileInputContainer').style.pointerEvents = 'auto'; // Kích hoạt lại input

                 // Cập nhật sourcePositions cho animation idle flow dựa trên vị trí đích cuối cùng
                 // Sử dụng array từ attribute geometry là chính xác nhất
                 if (particlesGeometry && particlesGeometry.attributes.position) {
                     sourcePositions.set(particlesGeometry.attributes.position.array);
                 } else {
                     // Fallback nếu particlesGeometry không tồn tại (trường hợp lỗi nghiêm trọng)
                     sourcePositions.set(currentTargetPositions);
                 }


                 isMorphing = false; // Reset flag
                 controls.autoRotate = true; // Bật lại auto rotate

            }).catch(error => {
                // Xử lý khi animation bị ngắt (ví dụ: người dùng chọn file mới trong lúc morph)
                console.warn("Morphing animation interrupted or failed:", error);
                // Trạng thái sau khi bị ngắt: có thể các hạt không ở đúng vị trí đích
                // Nên set sourcePositions cho idle flow dựa trên vị trí đích cuối cùng đã được cập nhật
                 if (currentTargetPositions) {
                      // Cập nhật vị trí hiện tại về thẳng vị trí đích nếu animation bị ngắt
                      if (particlesGeometry && particlesGeometry.attributes.position) {
                           particlesGeometry.attributes.position.array.set(currentTargetPositions);
                           particlesGeometry.attributes.position.needsUpdate = true;
                      }
                      // Set sourcePositions cho idle flow là vị trí đích
                      sourcePositions.set(currentTargetPositions);
                 } else if (defaultTargetPositions) {
                     // Nếu không có currentTargetPositions mới (lỗi xử lý ảnh?), quay về mặc định
                      if (particlesGeometry && particlesGeometry.attributes.position) {
                           particlesGeometry.attributes.position.array.set(defaultTargetPositions);
                           particlesGeometry.attributes.position.needsUpdate = true;
                      }
                      sourcePositions.set(defaultTargetPositions);
                 } else {
                      // Trường hợp lỗi nặng không có mục tiêu nào, quay về khối ban đầu
                      const initialCube = generateCube(CONFIG.particleCount, CONFIG.initialShapeSize);
                      if (particlesGeometry && particlesGeometry.attributes.position) {
                           particlesGeometry.attributes.position.array.set(initialCube);
                           particlesGeometry.attributes.position.needsUpdate = true;
                      }
                      sourcePositions.set(initialCube);
                 }

                 document.getElementById('info').innerText = `Morph interrupted. Choose Image.`;
                 document.getElementById('info').style.textShadow = '0 0 5px rgba(255, 165, 0, 0.8)'; // Màu cam cho cảnh báo
                 document.getElementById('fileInputContainer').style.pointerEvents = 'auto';
                 isMorphing = false;
                 controls.autoRotate = true;

            });


        };
        img.onerror = (error) => {
            console.error('Error loading image:', error);
            document.getElementById('info').innerText = `Error loading image.`;
            document.getElementById('info').style.textShadow = '0 0 8px rgba(255, 0, 0, 0.8)'; // Màu đỏ cho lỗi
            document.getElementById('fileInputContainer').style.pointerEvents = 'auto';
            isMorphing = false;
            controls.autoRotate = true;
             // Quay về trạng thái mặc định hoặc trước đó nếu tải ảnh lỗi
            if (defaultTargetPositions && defaultTargetColors) {
                 currentTargetPositions = defaultTargetPositions;
                 currentTargetColors = defaultTargetColors;
                 if (particlesGeometry && particlesGeometry.attributes.color) {
                      particlesGeometry.attributes.color.array.set(currentTargetColors);
                      particlesGeometry.attributes.color.needsUpdate = true;
                 }
                 // Cập nhật vị trí hiện tại và source cho idle flow về mặc định
                 if (particlesGeometry && particlesGeometry.attributes.position) {
                      particlesGeometry.attributes.position.array.set(currentTargetPositions);
                      particlesGeometry.attributes.position.needsUpdate = true;
                 }
                 sourcePositions.set(currentTargetPositions); // Set source cho idle flow về mặc định

                 document.getElementById('info').innerText = `Vinamilk Logo (Choose Image)`; // Hiển thị lại trạng thái mặc định
                 document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 180, 50, 0.8)';

            } else {
                 // Trường hợp không có cả logo mặc định, có thể quay về khối ngẫu nhiên
                  const initialCube = generateCube(CONFIG.particleCount, CONFIG.initialShapeSize);
                   if (particlesGeometry && particlesGeometry.attributes.position) {
                       particlesGeometry.attributes.position.array.set(initialCube);
                       particlesGeometry.attributes.position.needsUpdate = true;
                   }
                  sourcePositions.set(initialCube);
                  document.getElementById('info').innerText = `Ready (Choose Image)`;
                  document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
            }
             // Reset opacity về 1 (đã hiện ra)
             if (particlesGeometry && particlesGeometry.attributes.opacity) {
                  particlesGeometry.attributes.opacity.array.fill(1.0);
                  particlesGeometry.attributes.opacity.needsUpdate = true;
             }
              // Reset effect strength về 0
              if (particlesGeometry && particlesGeometry.attributes.aEffectStrength) {
                  particlesGeometry.attributes.aEffectStrength.array.fill(0.0);
                  particlesGeometry.attributes.aEffectStrength.needsUpdate = true;
             }
        };
        img.src = e.target.result; // Đặt source của ảnh từ kết quả đọc file
    };
    reader.onerror = (e) => {
        console.error('Error reading file:', e);
        document.getElementById('info').innerText = `Error reading file.`;
        document.getElementById('info').style.textShadow = '0 0 8px rgba(255, 0, 0, 0.8)';
        document.getElementById('fileInputContainer').style.pointerEvents = 'auto';
        isMorphing = false;
        controls.autoRotate = true;
         // Xử lý lỗi đọc file tương tự lỗi tải ảnh
        if (defaultTargetPositions && defaultTargetColors) {
             currentTargetPositions = defaultTargetPositions;
             currentTargetColors = defaultTargetColors;
              if (particlesGeometry && particlesGeometry.attributes.color) {
                  particlesGeometry.attributes.color.array.set(currentTargetColors);
                  particlesGeometry.attributes.color.needsUpdate = true;
              }
              if (particlesGeometry && particlesGeometry.attributes.position) {
                   particlesGeometry.attributes.position.array.set(currentTargetPositions);
                   particlesGeometry.attributes.position.needsUpdate = true;
              }
              sourcePositions.set(currentTargetPositions);
              document.getElementById('info').innerText = `Vinamilk Logo (Choose Image)`;
              document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 180, 50, 0.8)';
        } else {
              const initialCube = generateCube(CONFIG.particleCount, CONFIG.initialShapeSize);
               if (particlesGeometry && particlesGeometry.attributes.position) {
                   particlesGeometry.attributes.position.array.set(initialCube);
                   particlesGeometry.attributes.position.needsUpdate = true;
               }
              sourcePositions.set(initialCube);
              document.getElementById('info').innerText = `Ready (Choose Image)`;
              document.getElementById('info').style.textShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
        }
        // Reset opacity về 1 (đã hiện ra)
         if (particlesGeometry && particlesGeometry.attributes.opacity) {
              particlesGeometry.attributes.opacity.array.fill(1.0);
              particlesGeometry.attributes.opacity.needsUpdate = true;
         }
          // Reset effect strength về 0
          if (particlesGeometry && particlesGeometry.attributes.aEffectStrength) {
              particlesGeometry.attributes.aEffectStrength.array.fill(0.0);
              particlesGeometry.attributes.aEffectStrength.needsUpdate = true;
         }
    };

    reader.readAsDataURL(file); // Đọc file dưới dạng Data URL
}

// Thêm listener cho input file
function setupFileInputListener() {
    const fileInput = document.getElementById('imageInput');
    // Gỡ bỏ listener cũ nếu có để tránh lặp
    if (fileInput._listener) {
        fileInput.removeEventListener('change', fileInput._listener);
    }
    fileInput._listener = handleImageFileSelect; // Lưu listener để gỡ bỏ sau
    fileInput.addEventListener('change', fileInput._listener);

    // UI update sẽ được thực hiện trong callback 'complete' của initial morph
}


function setupPostProcessing() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold);
    composer.addPass(bloomPass);
}

// Hàm init chính, giờ sẽ chờ setupParticleSystem hoàn tất
async function init() {
    clock = new THREE.Clock();

    // Khởi tạo noise3D và noise4D BÊN TRONG hàm init
    // Sử dụng default export SimplexNoise đã import
    try {
        if (SimplexNoise && typeof SimplexNoise.createNoise3D === 'function' && typeof SimplexNoise.createNoise4D === 'function') {
             noise3D = SimplexNoise.createNoise3D(() => Math.random());
             noise4D = SimplexNoise.createNoise4D(() => Math.random());
             console.log("Simplex Noise functions initialized.");
        } else {
             console.error("Simplex Noise default export does not contain createNoise3D or createNoise4D functions.");
             console.warn("Noise effects will be disabled.");
             // Gán hàm dummy để tránh lỗi gọi hàm undefined sau này
             noise3D = () => 0;
             noise4D = () => 0;
        }
    } catch (e) {
         console.error("Failed to initialize Simplex Noise:", e);
         console.warn("Noise effects will be disabled.");
         // Gán hàm dummy để tránh lỗi gọi hàm undefined sau này
         noise3D = () => 0;
         noise4D = () => 0;
    }


    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000308, 0.04); // Sương mù nhẹ ở xa

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 30); // Vị trí camera ban đầu
    camera.lookAt(scene.position); // Nhìn vào trung tâm scene

    const canvas = document.getElementById('webglCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Giới hạn pixel ratio để tối ưu hiệu suất
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // Tone mapping cho màu sắc tốt hơn
    renderer.toneMappingExposure = 1.1; // Điều chỉnh độ sáng tone mapping

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Bật damping cho chuyển động mượt
    controls.dampingFactor = 0.05;
    controls.minDistance = 10; // Giới hạn zoom gần
    controls.maxDistance = 100; // Giới hạn zoom xa
    controls.autoRotate = false; // Tắt tự động xoay lúc khởi tạo ban đầu

    // Thêm đèn
    scene.add(new THREE.AmbientLight(0x404060)); // Đèn môi trường
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0x88aaff, 0.7);
    dirLight2.position.set(-10, -10, -10);
    scene.add(dirLight2);

    setupPostProcessing(); // Thiết lập hiệu ứng hậu kỳ
    createStarfield(); // Tạo nền sao một lần

    window.addEventListener('resize', onWindowResize); // Thêm listener resize

    // Bắt đầu vòng lặp animate ngay lập tức để xử lý controls và render composer
    // Logic xử lý hạt sẽ được bọc trong if(particlesGeometry)
    animate();

    // Await the full setup and initial morph process.
    console.log("Starting particle system setup and initial morph...");
    try {
        await setupParticleSystem(); // Chờ setupParticleSystem hoàn thành, bao gồm morph ban đầu

        console.log("Particle system setup and initial morph complete.");

        // Setup input file listener sau khi mọi thứ đã sẵn sàng và morph ban đầu xong
        setupFileInputListener();

        // Ẩn màn hình loading
         setTimeout(() => {
            document.getElementById('loading').style.opacity = '0';
            setTimeout(() => { document.getElementById('loading').style.display = 'none'; }, 600);
        }, 500);


    } catch (e) {
        console.error('Initialization failed:', e);
        const loadingSpan = document.querySelector('#loading span');
        const progressBar = document.getElementById('progress');
        loadingSpan.innerText = 'Initialization Error!';
        progressBar.style.backgroundColor = 'red';
        // Ẩn màn hình loading sau một chút kể cả khi lỗi
        setTimeout(() => {
            document.getElementById('loading').style.opacity = '0';
            setTimeout(() => { document.getElementById('loading').style.display = 'none'; }, 600);
        }, 2000);
        // Hiển thị UI chọn ảnh ngay cả khi khởi tạo lỗi, nhưng animation sẽ không hoạt động đúng
         setupFileInputListener();
         document.getElementById('info').innerText = `Initialization Error. Choose Image.`;
         document.getElementById('info').style.textShadow = '0 0 8px rgba(255, 0, 0, 0.8)';
         document.getElementById('fileInputContainer').style.pointerEvents = 'auto';

    }

}

// Hàm kích hoạt morphing đến vị trí đích hiện tại (currentTargetPositions)
// Có thể truyền tên mục tiêu để hiển thị UI
function triggerMorphToLogo(targetName = "Vinamilk Logo") {
    // Hàm này chỉ thiết lập timeline animation
    // Việc kiểm tra isMorphing và xử lý ngắt animation cũ được thực hiện ở handleImageFileSelect

    isMorphing = true; // Đặt cờ isMorphing
    // controls.autoRotate = false; // Đã tắt ở handleImageFileSelect
    // UI update đã làm ở handleImageFileSelect
    // document.getElementById('fileInputContainer').style.pointerEvents = 'none'; // Đã tắt ở handleImageFileSelect

    // Lưu vị trí hiện tại làm vị trí bắt đầu cho morphing
    // Sử dụng particlesGeometry.attributes.position.array thay vì currentPositions
    // để lấy vị trí chính xác nhất lúc bắt đầu morph
    // currentPositions sẽ được cập nhật bởi animejs trong quá trình morph
    if (!particlesGeometry || !particlesGeometry.attributes.position) {
        console.error("particlesGeometry or position attribute not available for morphing.");
         isMorphing = false;
         controls.autoRotate = true;
         document.getElementById('fileInputContainer').style.pointerEvents = 'auto';
         document.getElementById('info').innerText = `System Error. Choose Image.`;
         document.getElementById('info').style.textShadow = '0 0 8px rgba(255, 0, 0, 0.8)';
        // Trả về một Promise đã rejected
        return Promise.reject(new Error("Particles geometry not ready for morph."));
    }
     sourcePositions.set(particlesGeometry.attributes.position.array);

    // Vị trí đích là currentTargetPositions toàn cục
    const targetPositionsLogo = currentTargetPositions;

    // Tính toán vị trí "swarm" (điểm giữa có nhiễu) cho lần morph này
    // Swarm positions được tính toán MỖI LẦN morph bắt đầu
    const swarmPositions = new Float32Array(CONFIG.particleCount * 3);
    const centerOffsetAmount = CONFIG.initialShapeSize * CONFIG.swarmDistanceFactor * 0.5;

    for (let i = 0; i < CONFIG.particleCount; i++) {
        const i3 = i * 3;
        sourceVec.fromArray(sourcePositions, i3);
        targetVec.fromArray(targetPositionsLogo, i3);

        swarmVec.lerpVectors(sourceVec, targetVec, 0.5);

        // Thêm nhiễu ngẫu nhiên theo hướng ngẫu nhiên
        // Chỉ sử dụng noise nếu đã được khởi tạo thành công
        const offsetDir = tempVec; // Tái sử dụng tempVec
        if (noise3D) {
            offsetDir.set( noise3D(i * 0.05, 10, 10), noise3D(20, i * 0.05, 20), noise3D(30, 30, i * 0.05) ).normalize();
        } else {
             offsetDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); // Fallback random direction
        }

        // Độ lớn nhiễu phụ thuộc vào khoảng cách giữa source và target, và một hệ số cố định
        const distFactor = sourceVec.distanceTo(targetVec) * 0.2 + centerOffsetAmount;
        swarmVec.addScaledVector(offsetDir, distFactor * (0.3 + Math.random() * 0.7));

        swarmPositions [i3] = swarmVec.x;
        swarmPositions [i3 + 1] = swarmVec.y;
        swarmPositions [i3 + 2] = swarmVec.z;
    }

    // Reset tiến trình morph và bắt đầu animation mới
    morphState.progress = 0; // Reset tiến trình cho timeline mới
    morphTimeline = anime({
        targets: morphState,
        progress: 1,
        duration: CONFIG.morphDuration, // Sử dụng morphDuration từ CONFIG
        easing: 'cubicBezier(0.4, 0.0, 0.2, 1.0)', // Easing mềm mại
        update: () => {
            const t = morphState.progress; // Tiến trình từ 0 đến 1
            // Tính toán độ mạnh của hiệu ứng (lên đỉnh ở giữa animation)
            const effectStrength = Math.sin(t * Math.PI); // Đi từ 0 -> 1 -> 0

            // Tính toán cường độ xoáy và nhiễu cho frame hiện tại
            const currentSwirlStrength = effectStrength * CONFIG.swirlFactor;
            const currentNoiseStrength = effectStrength * CONFIG.noiseMaxStrength;
            const noiseTime = clock.elapsedTime * CONFIG.noiseTimeScale;


            for (let i = 0; i < CONFIG.particleCount; i++) {
                const i3 = i * 3;

                sourceVec.fromArray(sourcePositions, i3); // Vị trí bắt đầu morph của hạt i
                swarmVec.fromArray(swarmPositions, i3); // Vị trí swarm của hạt i cho lần morph này
                targetVec.fromArray(targetPositionsLogo, i3); // Vị trí đích của hạt i cho lần morph này

                // Tính toán vị trí trung gian sử dụng Quadratic Bezier curve
                // P(t) = (1-t)^2 * P0 + 2*(1-t)*t*P1 + t^2 * P2
                const t_inv = 1.0 - t;
                const t_inv_sq = t_inv * t_inv;
                const t_sq = t * t;

                bezPos.copy(sourceVec).multiplyScalar(t_inv_sq);
                bezPos.addScaledVector(swarmVec, 2.0 * t_inv * t);
                bezPos.addScaledVector(targetVec, t_sq);

                // Thêm hiệu ứng xoáy (chỉ khi effectStrength đáng kể và noise3D có sẵn)
                if (currentSwirlStrength > 0.001 && noise3D) {
                     // Tính vector từ source đến điểm bezier hiện tại
                     tempVec.subVectors(bezPos, sourceVec);
                     // Trục xoáy dựa trên nhiễu 3D hoặc 4D theo thời gian và index hạt
                     swirlAxis.set(
                         noise3D(i * 0.02, clock.elapsedTime * 0.1, 0),
                         noise3D(0, i * 0.02, clock.elapsedTime * 0.1 + 5),
                         noise3D(clock.elapsedTime * 0.1 + 10, 0, i * 0.02)
                     ).normalize();
                     // Áp dụng phép quay quanh trục swirlAxis với góc dựa trên currentSwirlStrength
                     // Nhân thêm random để tạo sự hỗn loạn nhẹ
                     tempVec.applyAxisAngle(swirlAxis, currentSwirlStrength * (0.5 + Math.random() * 0.5));
                     // Vị trí cuối sau xoáy là source + vector đã xoáy
                     bezPos.copy(sourceVec).add(tempVec);
                 }

                // Thêm nhiễu Simplex (chỉ khi effectStrength đáng kể và noise4D có sẵn)
                if (currentNoiseStrength > 0.001 && noise4D) {
                    noiseOffset.set(
                         noise4D(bezPos.x * CONFIG.noiseFrequency, bezPos.y * CONFIG.noiseFrequency, bezPos.z * CONFIG.noiseFrequency, noiseTime),
                         noise4D(bezPos.x * CONFIG.noiseFrequency + 100, bezPos.y * CONFIG.noiseFrequency + 100, bezPos.z * CONFIG.noiseFrequency + 100, noiseTime),
                         noise4D(bezPos.x * CONFIG.noiseFrequency + 200, bezPos.y * CONFIG.noiseFrequency + 200, bezPos.z * CONFIG.noiseFrequency + 200, noiseTime)
                     );
                    bezPos.addScaledVector(noiseOffset, currentNoiseStrength); // Thêm nhiễu theo độ mạnh hiện tại
                }

                // Cập nhật trực tiếp vào attribute array của geometry
                particlesGeometry.attributes.position.array [i3] = bezPos.x;
                particlesGeometry.attributes.position.array [i3 + 1] = bezPos.y;
                particlesGeometry.attributes.position.array [i3 + 2] = bezPos.z;

                // Cập nhật độ mạnh hiệu ứng cho shader
                particlesGeometry.attributes.aEffectStrength.array [i] = effectStrength;
            }

            // Đánh dấu các attribute cần cập nhật trong vòng lặp animate
            // needsUpdate được xử lý trong animate loop
        }
        // Callback complete và catch handled trong handleImageFileSelect
    });

     // Trả về timeline để có thể theo dõi trạng thái finished/caught
     return morphTimeline;
}


function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta(); // Thời gian giữa các frame

    // Cập nhật controls (luôn chạy)
    controls.update();

    // --- Particle specific logic ---
    // CHỈ chạy logic liên quan đến hạt nếu particlesGeometry đã được tạo
    if (particlesGeometry) {

        const positionsArray = particlesGeometry.attributes.position.array;
        const effectStrengthsArray = particlesGeometry.attributes.aEffectStrength.array;
        const opacityArray = particlesGeometry.attributes.opacity.array;

        // Nếu đang morphing, animejs update callback đã ghi trực tiếp vào positionsArray và effectStrengthsArray
        // Chỉ cần đảm bảo needsUpdate được gọi một lần mỗi frame nếu có thay đổi
        if (isMorphing) {
             particlesGeometry.attributes.position.needsUpdate = true;
             particlesGeometry.attributes.aEffectStrength.needsUpdate = true;
             // Opacity attribute cũng có timeline animejs riêng, needsUpdate được set trong callback của nó

        } else {
            // Idle flow animation chỉ khi KHÔNG morphing
            const timeScaled = clock.elapsedTime * CONFIG.idleFlowSpeed;
            const freq = 0.1;
            let needsPositionUpdate = false;
            let needsEffectStrengthReset = false; // Cờ để biết có cần set needsUpdate cho effectStrength không
            let needsOpacityReset = false; // Cờ để biết có cần set needsUpdate cho opacity không


            for (let i = 0; i < CONFIG.particleCount; i++) {
                const i3 = i * 3;
                // sourcePositions được set bằng vị trí đích cuối cùng sau mỗi lần morph xong
                sourceVec.fromArray(sourcePositions, i3);

                tempVec.copy(sourceVec);
                 // Chỉ áp dụng noise flow nếu các hàm noise có sẵn
                 if (noise4D) {
                    flowVec.set( noise4D(tempVec.x * freq, tempVec.y * freq, tempVec.z * freq, timeScaled), noise4D(tempVec.x * freq + 10, tempVec.y * freq + 10, tempVec.z * freq + 10, timeScaled), noise4D(tempVec.x * freq + 20, tempVec.y * freq + 20, tempVec.z * freq + 20, timeScaled) );
                    tempVec.addScaledVector(flowVec, CONFIG.idleFlowStrength);
                 }


                currentVec.fromArray(positionsArray, i3); // Đọc vị trí hiện tại của hạt
                // Nội suy về vị trí đích + nhiễu (nếu có nhiễu)
                currentVec.lerp(tempVec, 0.03); // Lerp nhẹ nhàng để tạo hiệu ứng trôi

                // Cập nhật vị trí chỉ khi nó thay đổi để tối ưu
                // if (currentVec.distanceToSquared(tempVec) > 0.0001) { // Kiểm tra khoảng cách bình phương
                    positionsArray [i3] = currentVec.x; // Ghi lại vị trí mới
                    positionsArray [i3 + 1] = currentVec.y;
                    positionsArray [i3 + 2] = currentVec.z;
                    needsPositionUpdate = true;
                // }


                // Đảm bảo effect strength là 0 khi idle
                if (effectStrengthsArray [i] !== 0.0) {
                     effectStrengthsArray [i] = 0.0;
                     needsEffectStrengthReset = true; // Cần đánh dấu update nếu có thay đổi
                 }

                 // Đảm bảo opacity là 1 khi idle (sau khi fade-in ban đầu hoặc morph)
                 // Chỉ set về 1 nếu morph timeline cuối cùng đã hoàn thành
                 if (opacityArray[i] !== 1.0 && morphTimeline && morphTimeline.progress >= 1) {
                      opacityArray[i] = 1.0;
                      needsOpacityReset = true; // Cần đánh dấu update
                 }
            }

            if (needsPositionUpdate) particlesGeometry.attributes.position.needsUpdate = true;
            if (needsEffectStrengthReset) particlesGeometry.attributes.aEffectStrength.needsUpdate = true;
            if (needsOpacityReset) particlesGeometry.attributes.opacity.needsUpdate = true;

        }

    } // --- Kết thúc logic hạt ---


    // Render scene sử dụng composer
    // Composer sẽ render những gì đang có trong scene, bao gồm cả hạt nếu chúng đã được tạo và được cập nhật
    composer.render(deltaTime);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// Bắt đầu quá trình khởi tạo
init();
