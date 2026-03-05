import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// --- ゲーム状態管理 ---
const STATE = { PLAYING: 0, LEVELUP: 1, GAMEOVER: 2 };
let currentState = STATE.PLAYING;

// --- DOMエレメント ---
const elHpFill = document.getElementById('hp-fill');
const elExpFill = document.getElementById('exp-fill');
const elLevelText = document.getElementById('level-text');
const elSkillFill = document.getElementById('skill-fill');
const elSkillText = document.getElementById('skill-text');
const screenLevelUp = document.getElementById('levelup-screen');
const screenGameOver = document.getElementById('gameover-screen');

// --- Three.js セットアップ ---
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

// 見下ろしカメラ
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 30, 20);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// 照明
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// 床（目印用グリッド）
const gridHelper = new THREE.GridHelper(200, 50, 0x333333, 0x222222);
scene.add(gridHelper);

// --- 共通マテリアル＆ジオメトリ ---
const geoPlayer = new THREE.BoxGeometry(2, 2, 2);
const matPlayer = new THREE.MeshStandardMaterial({ color: 0x0077ff });
const geoEnemy = new THREE.SphereGeometry(1.2, 16, 16);
const matEnemy = new THREE.MeshStandardMaterial({ color: 0xff3333 });
const matEnemyMarked = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // マーカー状態
const geoBullet = new THREE.SphereGeometry(0.4, 8, 8);
const matBullet = new THREE.MeshStandardMaterial({ color: 0xffff00 });
const geoOrb = new THREE.OctahedronGeometry(0.6);
const matOrb = new THREE.MeshStandardMaterial({ color: 0x33ff33 });
const geoParticle = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const matParticle = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

// --- グローバル変数 ---
const keys = { w: false, a: false, s: false, d: false };
let enemies = [];
let bullets = [];
let orbs = [];
let particles = [];
let lastTime = performance.now();
let spawnTimer = 0;
let autoAttackTimer = 0;
let hitStopTimer = 0; // ヒットストップ用

// --- プレイヤーステータス ---
const playerStats = {
    hp: 100, maxHp: 100, exp: 0, nextExp: 10, level: 1,
    accel: 60, friction: 0.85, maxSpeed: 15,
    fireRate: 1.0, bulletSpeed: 30, multiShot: 1, damage: 30,
    skillGauge: 0, isTimeStopped: false, timeStopDuration: 0
};

// プレイヤー生成
const playerMesh = new THREE.Mesh(geoPlayer, matPlayer);
playerMesh.position.y = 1;
scene.add(playerMesh);
const playerVelocity = new THREE.Vector3(0, 0, 0);

// --- 入力処理 ---
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === 'e' && currentState === STATE.PLAYING && playerStats.skillGauge >= 100 && !playerStats.isTimeStopped) {
        activateTimeStop();
    }
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
});

// --- クラス定義 ---
class Enemy {
    constructor(x, z) {
        this.mesh = new THREE.Mesh(geoEnemy, matEnemy);
        this.mesh.position.set(x, 1.2, z);
        scene.add(this.mesh);
        this.hp = 50 + (playerStats.level * 10);
        this.speed = 5 + Math.random() * 3;
        this.markCount = 0; // 時間停止中のマーカー
    }
}

class Bullet {
    constructor(pos, dir) {
        this.mesh = new THREE.Mesh(geoBullet, matBullet);
        this.mesh.position.copy(pos);
        scene.add(this.mesh);
        this.velocity = dir.normalize().multiplyScalar(playerStats.bulletSpeed);
        this.life = 2.0;
    }
}

class Orb {
    constructor(pos) {
        this.mesh = new THREE.Mesh(geoOrb, matOrb);
        this.mesh.position.copy(pos);
        this.mesh.position.y = 0.5;
        scene.add(this.mesh);
        this.exp = 5;
    }
}

class Particle {
    constructor(pos, colorMat) {
        this.mesh = new THREE.Mesh(geoParticle, colorMat || matParticle);
        this.mesh.position.copy(pos);
        scene.add(this.mesh);
        this.velocity = new THREE.Vector3((Math.random()-0.5)*15, Math.random()*15, (Math.random()-0.5)*15);
        this.life = 0.3 + Math.random() * 0.3;
    }
}

// --- ゲームロジック ---
function createParticles(pos, count, mat) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(pos, mat));
    }
}

function activateTimeStop() {
    playerStats.isTimeStopped = true;
    playerStats.skillGauge = 0;
    playerStats.timeStopDuration = 2.0; // 2秒間停止
    elSkillText.innerText = "TIME STOPPED!";
    elSkillText.style.color = "#ffaa00";
    elSkillFill.style.backgroundColor = "#ffaa00";
    scene.background = new THREE.Color(0x0a0a1a); // 背景を暗くして演出
}

function releaseTimeStop() {
    playerStats.isTimeStopped = false;
    elSkillText.innerText = "E KEY: TIME STOP";
    elSkillText.style.color = "#fff";
    elSkillFill.style.backgroundColor = "#44aaff";
    scene.background = new THREE.Color(0x1a1a2e);

    // マーカー爆発処理
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (enemy.markCount > 0) {
            const burstDamage = enemy.markCount * playerStats.damage * 1.5; // マーカーによるダメージボーナス
            enemy.hp -= burstDamage;
            createParticles(enemy.mesh.position, enemy.markCount * 5); // 派手なパーティクル
            enemy.markCount = 0;
            enemy.mesh.material = matEnemy;
            
            if (enemy.hp <= 0) {
                orbs.push(new Orb(enemy.mesh.position));
                scene.remove(enemy.mesh);
                enemies.splice(i, 1);
            }
        }
    }
}

function getNearestEnemy() {
    let nearest = null;
    let minDist = Infinity;
    for (const enemy of enemies) {
        const dist = playerMesh.position.distanceTo(enemy.mesh.position);
        if (dist < minDist) { minDist = dist; nearest = enemy; }
    }
    return nearest;
}

function updateUI() {
    elHpFill.style.width = `${Math.max(0, (playerStats.hp / playerStats.maxHp) * 100)}%`;
    elExpFill.style.width = `${Math.min(100, (playerStats.exp / playerStats.nextExp) * 100)}%`;
    elLevelText.innerText = `Lv ${playerStats.level}`;
    elSkillFill.style.width = `${playerStats.skillGauge}%`;
}

function checkLevelUp() {
    if (playerStats.exp >= playerStats.nextExp) {
        playerStats.exp -= playerStats.nextExp;
        playerStats.level++;
        playerStats.nextExp = Math.floor(playerStats.nextExp * 1.5);
        playerStats.maxHp += 20;
        playerStats.hp = playerStats.maxHp;
        
        currentState = STATE.LEVELUP;
        screenLevelUp.style.display = 'flex';
        updateUI();
    }
}

function gameOver() {
    currentState = STATE.GAMEOVER;
    screenGameOver.style.display = 'flex';
}

// --- メインループ ---
function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1; // タブ切り替え時の暴走防止

    // ヒットストップ処理 (描画はするがロジック更新をスキップ)
    if (hitStopTimer > 0) {
        hitStopTimer -= dt;
        renderer.render(scene, camera);
        return;
    }

    if (currentState !== STATE.PLAYING) {
        renderer.render(scene, camera);
        return; // UI表示中などはゲーム停止
    }

    // --- プレイヤー移動 (慣性あり) ---
    let inputDir = new THREE.Vector3(0, 0, 0);
    if (keys.w) inputDir.z -= 1;
    if (keys.s) inputDir.z += 1;
    if (keys.a) inputDir.x -= 1;
    if (keys.d) inputDir.x += 1;
    
    if (inputDir.lengthSq() > 0) inputDir.normalize();
    
    playerVelocity.x += inputDir.x * playerStats.accel * dt;
    playerVelocity.z += inputDir.z * playerStats.accel * dt;
    
    // 摩擦（減衰）
    playerVelocity.x *= playerStats.friction;
    playerVelocity.z *= playerStats.friction;
    
    // 速度制限
    if (playerVelocity.lengthSq() > playerStats.maxSpeed * playerStats.maxSpeed) {
        playerVelocity.normalize().multiplyScalar(playerStats.maxSpeed);
    }

    playerMesh.position.addScaledVector(playerVelocity, dt);
    
    // カメラ追従
    camera.position.x = playerMesh.position.x;
    camera.position.z = playerMesh.position.z + 20;

    // --- 時間停止ギミックの更新 ---
    if (playerStats.isTimeStopped) {
        playerStats.timeStopDuration -= dt;
        if (playerStats.timeStopDuration <= 0) {
            releaseTimeStop();
        }
    } else {
        // ゲージを自動回復（1秒に10増加、10秒でMAX）
        if (playerStats.skillGauge < 100) {
            playerStats.skillGauge += 10 * dt;
            if (playerStats.skillGauge > 100) playerStats.skillGauge = 100;
        }
    }

    // --- 敵のスポーン ---
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < 50) {
        spawnTimer = Math.max(0.5, 2.0 - playerStats.level * 0.1); // 徐々に早く
        const angle = Math.random() * Math.PI * 2;
        const radius = 30; // 画面外の円周上
        const ex = playerMesh.position.x + Math.cos(angle) * radius;
        const ez = playerMesh.position.z + Math.sin(angle) * radius;
        enemies.push(new Enemy(ex, ez));
    }

    // --- 自動攻撃 ---
    autoAttackTimer -= dt;
    if (autoAttackTimer <= 0) {
        autoAttackTimer = playerStats.fireRate;
        const target = getNearestEnemy();
        if (target) {
            const baseDir = new THREE.Vector3().subVectors(target.mesh.position, playerMesh.position);
            baseDir.y = 0;
            
            // 複数発射の扇状展開
            const spread = 0.2; 
            const startAngle = -spread * (playerStats.multiShot - 1) / 2;
            
            for (let i = 0; i < playerStats.multiShot; i++) {
                const dir = baseDir.clone();
                dir.applyAxisAngle(new THREE.Vector3(0,1,0), startAngle + (i * spread));
                bullets.push(new Bullet(playerMesh.position, dir));
            }
        }
    }

    // --- 敵の更新 ---
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        
        // 時間停止中以外は追跡
        if (!playerStats.isTimeStopped) {
            const dir = new THREE.Vector3().subVectors(playerMesh.position, enemy.mesh.position).normalize();
            enemy.mesh.position.addScaledVector(dir, enemy.speed * dt);
            
            // プレイヤーとの衝突判定
            if (enemy.mesh.position.distanceTo(playerMesh.position) < 2.2) { // 半径1.0(Player) + 1.2(Enemy)
                playerStats.hp -= 20 * dt; // 接触ダメージ（継続）
                if (playerStats.hp <= 0) gameOver();
            }
        }
    }

    // --- 弾の更新 ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.mesh.position.addScaledVector(bullet.velocity, dt);
        bullet.life -= dt;
        
        let hit = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const enemy = enemies[j];
            if (bullet.mesh.position.distanceTo(enemy.mesh.position) < 1.6) { // 半径0.4 + 1.2
                hit = true;
                
                if (playerStats.isTimeStopped) {
                    // 時間停止中：マーキング処理
                    enemy.markCount++;
                    enemy.mesh.material = matEnemyMarked; // 色を変える
                } else {
                    // 通常時：ダメージ処理
                    enemy.hp -= playerStats.damage;
                    hitStopTimer = 0.05; // 0.05秒のヒットストップ！
                    createParticles(enemy.mesh.position, 3); // 簡易パーティクル
                    
                    if (enemy.hp <= 0) {
                        orbs.push(new Orb(enemy.mesh.position));
                        scene.remove(enemy.mesh);
                        enemies.splice(j, 1);
                    }
                }
                break; // 1発1体にヒットで弾消滅
            }
        }
        
        if (hit || bullet.life <= 0) {
            scene.remove(bullet.mesh);
            bullets.splice(i, 1);
        }
    }

    // --- オーブの更新 (回収) ---
    for (let i = orbs.length - 1; i >= 0; i--) {
        const orb = orbs[i];
        // プレイヤーが近づいたら引き寄せる
        const dist = orb.mesh.position.distanceTo(playerMesh.position);
        if (dist < 8) {
            const dir = new THREE.Vector3().subVectors(playerMesh.position, orb.mesh.position).normalize();
            orb.mesh.position.addScaledVector(dir, 15 * dt);
        }
        
        // 取得判定
        if (orb.mesh.position.distanceTo(playerMesh.position) < 2) {
            playerStats.exp += orb.exp;
            scene.remove(orb.mesh);
            orbs.splice(i, 1);
            checkLevelUp();
        }
    }

    // --- パーティクルの更新 ---
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.life -= dt;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }

    updateUI();
    renderer.render(scene, camera);
}

// --- イベントリスナー (UI) ---
document.getElementById('choice-firerate').addEventListener('click', () => {
    playerStats.fireRate = Math.max(0.1, playerStats.fireRate - 0.2); resumeGame();
});
document.getElementById('choice-speed').addEventListener('click', () => {
    playerStats.bulletSpeed += 10; resumeGame();
});
document.getElementById('choice-multishot').addEventListener('click', () => {
    playerStats.multiShot += 1; resumeGame();
});
document.getElementById('restart-btn').addEventListener('click', () => {
    location.reload(); // 手軽なリセット方法
});

function resumeGame() {
    screenLevelUp.style.display = 'none';
    lastTime = performance.now(); // 停止中の時間経過をリセット
    currentState = STATE.PLAYING;
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ゲームスタート
animate();
