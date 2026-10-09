import { PauseIcon, PlayIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import "./popup.css";

type RenderMode = "starting" | "tracing" | "raster" | "unavailable";
type Commands = { reset(): void; pause(value: boolean): void };

function RtxOn() {
	const surface = useRef<HTMLDivElement>(null);
	const commands = useRef<Commands | null>(null);
	const [mode, setMode] = useState<RenderMode>("starting");
	const [samples, setSamples] = useState(0);
	const [paused, setPaused] = useState(false);

	useEffect(() => {
		const host = surface.current!;
		let disposed = false;
		let frame = 0;
		let renderer: THREE.WebGLRenderer | undefined;
		let tracer: WebGLPathTracer | undefined;
		let controls: OrbitControls | undefined;
		let environment: THREE.DataTexture | undefined;
		let face: THREE.CanvasTexture | undefined;
		let resize = () => {};
		const scene = new THREE.Scene();

		const cleanup = () => {
			if (disposed) return;
			disposed = true;
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", resize);
			window.removeEventListener("pagehide", cleanup);
			controls?.dispose();
			tracer?.dispose();
			environment?.dispose();
			face?.dispose();
			const geometries = new Set<THREE.BufferGeometry>();
			const materials = new Set<THREE.Material>();
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh) {
					geometries.add(object.geometry);
					for (const material of Array.isArray(object.material)
						? object.material
						: [object.material])
						materials.add(material);
				}
			});
			for (const geometry of geometries) geometry.dispose();
			for (const material of materials) material.dispose();
			renderer?.dispose();
			host.replaceChildren();
			commands.current = null;
		};

		async function start() {
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.domElement.setAttribute("aria-label", "Humid proof-of-photons coin");
			renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
			host.append(renderer.domElement);

			const logo = await new THREE.TextureLoader().loadAsync(
				new URL("../../../assets/brand/humid-mark.svg", import.meta.url).href,
			);
			if (disposed) {
				logo.dispose();
				return;
			}
			const stamp = document.createElement("canvas");
			stamp.width = stamp.height = 1024;
			const ink = stamp.getContext("2d")!;
			ink.fillStyle = "#d0f7e5";
			ink.fillRect(0, 0, 1024, 1024);
			ink.drawImage(logo.image, 222, 230, 580, 580);
			ink.fillStyle = "#15382c";
			ink.font = "bold 48px monospace";
			ink.textAlign = "center";
			ink.fillText("HUMID", 512, 163);
			ink.font = "28px monospace";
			ink.fillText("PROOF OF PHOTONS", 512, 870);
			logo.dispose();
			face = new THREE.CanvasTexture(stamp);
			face.colorSpace = THREE.SRGBColorSpace;

			const lightPixels = new Float32Array(64 * 32 * 4);
			for (let row = 0; row < 32; row++) {
				for (let column = 0; column < 64; column++) {
					let color = row < 16 ? [0.9, 1.0, 1.1] : [0.3, 0.35, 0.4];
					if (column > 10 && column < 17 && row > 5 && row < 24) color = [1.2, 4.0, 2.6];
					if (column > 43 && column < 50 && row > 6 && row < 24) color = [4.0, 1.8, 1.2];
					if (column > 24 && column < 34 && row > 2 && row < 10) color = [6, 6, 6];
					lightPixels.set([...color, 1], (row * 64 + column) * 4);
				}
			}
			environment = new THREE.DataTexture(
				Uint16Array.from(lightPixels, THREE.DataUtils.toHalfFloat),
				64,
				32,
				THREE.RGBAFormat,
				THREE.HalfFloatType,
			);
			environment.mapping = THREE.EquirectangularReflectionMapping;
			environment.needsUpdate = true;
			scene.environment = environment;
			scene.background = new THREE.Color(0xf1f4f3);

			const coin = new THREE.Group();
			coin.position.y = 0.6;
			coin.rotation.set(0, -0.18, -0.13);
			const edge = new THREE.MeshPhysicalMaterial({
				color: 0xe6efed,
				metalness: 1,
				roughness: 0.17,
			});
			const body = new THREE.CylinderGeometry(1, 1, 0.2, 96);
			body.rotateX(Math.PI / 2);
			coin.add(new THREE.Mesh(body, edge));
			const badge = new THREE.Mesh(
				new THREE.CircleGeometry(0.88, 96),
				new THREE.MeshPhysicalMaterial({
					map: face,
					metalness: 0.5,
					roughness: 0.3,
					clearcoat: 0.8,
				}),
			);
			badge.position.z = 0.102;
			coin.add(badge);
			for (const depth of [-0.1, 0.1]) {
				const rim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.027, 8, 96), edge);
				rim.position.z = depth;
				coin.add(rim);
			}
			scene.add(coin);
			const floor = new THREE.Mesh(
				new THREE.PlaneGeometry(200, 200),
				new THREE.MeshStandardMaterial({ color: 0xdfe7e3, roughness: 0.24, metalness: 0.15 }),
			);
			floor.rotation.x = -Math.PI / 2;
			floor.position.y = -0.8;
			scene.add(floor);
			const key = new THREE.RectAreaLight(0xffffff, 18, 3, 4);
			key.position.set(2, 4, 3);
			key.lookAt(coin.position);
			scene.add(key, new THREE.HemisphereLight(0xffffff, 0x8ea99b, 2));

			const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 0.55, 0);
			controls.enableDamping = true;
			controls.enablePan = false;
			controls.minDistance = 4;
			controls.maxDistance = 12;
			controls.maxPolarAngle = Math.PI * 0.49;
			let pausedRendering = false;
			resize = () => {
				const width = host.clientWidth;
				const height = host.clientHeight;
				renderer!.setSize(width, height);
				camera.aspect = width / height;
				camera.position.set(2.4, 1.8, 5.2).multiplyScalar(width < 600 ? 1.4 : 1);
				camera.updateProjectionMatrix();
				controls!.update();
				controls!.saveState();
				if (tracer) {
					tracer.renderScale = Math.min(1, 600 / width);
					tracer.updateCamera();
				}
				setSamples(0);
			};
			resize();
			window.addEventListener("resize", resize);
			window.addEventListener("pagehide", cleanup);
			controls.addEventListener("change", () => {
				camera.updateMatrixWorld();
				tracer?.updateCamera();
			});

			try {
				tracer = new WebGLPathTracer(renderer);
				tracer.bounces = 5;
				tracer.tiles.set(2, 2);
				tracer.renderScale = Math.min(1, 600 / host.clientWidth);
				tracer.renderDelay = 150;
				tracer.fadeDuration = 250;
				tracer.setScene(scene, camera);
				setMode("tracing");
			} catch (error: unknown) {
				console.warn("Humid RTX mode is using raster rendering", error);
				tracer?.dispose();
				tracer = undefined;
				setMode("raster");
			}
			commands.current = {
				reset() {
					controls!.reset();
					tracer?.reset();
					setSamples(0);
				},
				pause(value) {
					pausedRendering = value;
					controls!.enabled = !value;
				},
			};
			let lastRead = 0;
			const render = (time: number) => {
				if (disposed) return;
				frame = requestAnimationFrame(render);
				if (document.hidden || pausedRendering) return;
				controls!.update();
				if (tracer) {
					tracer.pausePathTracing = tracer.samples >= 128;
					tracer.renderSample();
					if (time - lastRead > 500) {
						lastRead = time;
						setSamples(Math.floor(tracer.samples));
					}
				} else renderer!.render(scene, camera);
			};
			frame = requestAnimationFrame(render);
		}

		void start().catch((error: unknown) => {
			if (!disposed) {
				console.error("Humid RTX mode could not start", error);
				setMode("unavailable");
			}
			cleanup();
		});
		return cleanup;
	}, []);

	return (
		<main className="fixed inset-0 overflow-hidden bg-[#f1f4f3] text-[#15382c]">
			<div ref={surface} className="absolute inset-0" />
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-6 sm:p-9">
				<div>
					<h1 className="text-3xl font-bold">Humid</h1>
					<p className="mt-1 font-mono text-xs text-[#577266]">PROOF OF PHOTONS</p>
				</div>
				<div className="text-right font-mono">
					<strong className="text-sm">
						{mode === "starting" ? "GPU PAPERWORK" : mode === "tracing" ? "RTX ON" : "RTX OFF"}
					</strong>
					<p className="mt-1 text-xs text-[#577266]">
						{mode === "tracing"
							? `${samples} / 128 samples`
							: mode === "starting"
								? "one moment"
								: "GPU declined the promotion"}
					</p>
				</div>
			</header>
			{mode === "unavailable" && (
				<p role="alert" className="absolute inset-x-6 top-1/2 text-center">
					Your GPU has unionized. Wallet unaffected.
				</p>
			)}
			<footer className="pointer-events-none absolute inset-x-0 bottom-0 p-6 sm:p-9">
				<p className="max-w-xl text-2xl font-semibold sm:text-4xl">
					Future
					<br />
					with NVidia
				</p>
				<div className="mt-4 flex items-end justify-between gap-3">
					<p className="max-w-64 font-mono text-xs text-[#577266]">
						Financial performance: unchanged.
						<br />
						Lighting budget: irresponsible.
					</p>
					<div className="pointer-events-auto flex shrink-0 gap-2">
						<button
							className="flex size-10 items-center justify-center rounded-lg border border-[#9cbcaf] bg-white/80 hover:bg-white disabled:opacity-40"
							disabled={mode === "starting" || mode === "unavailable"}
							aria-label={paused ? "Resume rendering" : "Pause rendering"}
							title={paused ? "Resume rendering" : "Pause rendering"}
							onClick={() => {
								const next = !paused;
								commands.current?.pause(next);
								setPaused(next);
							}}
						>
							<HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={19} />
						</button>
						<button
							className="flex size-10 items-center justify-center rounded-lg border border-[#9cbcaf] bg-white/80 hover:bg-white disabled:opacity-40"
							disabled={mode === "starting" || mode === "unavailable"}
							aria-label="Reset view"
							title="Reset view"
							onClick={() => {
								commands.current?.reset();
								commands.current?.pause(false);
								setPaused(false);
							}}
						>
							<HugeiconsIcon icon={RefreshIcon} size={19} />
						</button>
					</div>
				</div>
			</footer>
		</main>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("RTX scene root was not found");
createRoot(root).render(<RtxOn />);
