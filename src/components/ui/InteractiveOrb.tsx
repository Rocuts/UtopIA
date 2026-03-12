import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import * as THREE from 'three';

interface InteractiveOrbProps {
  volume: number;
  isConnected: boolean;
  isConnecting: boolean;
}

export function InteractiveOrb({ volume, isConnected, isConnecting }: InteractiveOrbProps) {
  const outerHaloRef = useRef<THREE.Mesh>(null);
  const innerHaloRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  // Generate a random seed for noise variance
  const seed = useMemo(() => Math.random(), []);

  useFrame((state) => {
    if (!outerHaloRef.current || !innerHaloRef.current || !coreRef.current) return;

    const t = state.clock.getElapsedTime();

    // Base colors: Cyan (idle), Amber (connecting), Purple/Pink (speaking)
    let color = new THREE.Color("#00e5ff"); 
    let scaleMultiplierTarget = 1.0;

    if (isConnecting) {
      color.set("#f59e0b");
      scaleMultiplierTarget = 1.2 + Math.sin(t * 5) * 0.1; // Fast pulse
    } else if (isConnected) {
      // Pulse scale organically by audio volume
      scaleMultiplierTarget = 1.0 + (volume * 1.5); 

      if (volume > 0.05) {
        const speakingColor = new THREE.Color("#ec4899"); // Pink
        speakingColor.lerp(new THREE.Color("#8b5cf6"), Math.sin(t * 2) * 0.5 + 0.5); // Pulse pink/purple
        color.lerp(speakingColor, volume * 3); 
      }
    }

    const lerpFactor = 0.15;
    
    // Animate Outer Halo (Soft, large glow)
    outerHaloRef.current.scale.lerp(new THREE.Vector3(1.5 * scaleMultiplierTarget, 1.5 * scaleMultiplierTarget, 1.5 * scaleMultiplierTarget), lerpFactor);
    (outerHaloRef.current.material as THREE.MeshBasicMaterial).color.lerp(color, lerpFactor);
    outerHaloRef.current.rotation.y = t * 0.2;
    outerHaloRef.current.rotation.x = Math.sin(t * 0.5 + seed) * 0.2;

    // Animate Inner Halo (More dense, smaller)
    innerHaloRef.current.scale.lerp(new THREE.Vector3(1.0 * scaleMultiplierTarget, 1.0 * scaleMultiplierTarget, 1.0 * scaleMultiplierTarget), lerpFactor);
    (innerHaloRef.current.material as THREE.MeshBasicMaterial).color.lerp(color, lerpFactor);
    innerHaloRef.current.rotation.y = -t * 0.3;
    innerHaloRef.current.rotation.z = Math.cos(t * 0.4) * 0.2;

    // Animate Core (Brightest center)
    coreRef.current.scale.lerp(new THREE.Vector3(0.5 * scaleMultiplierTarget, 0.5 * scaleMultiplierTarget, 0.5 * scaleMultiplierTarget), lerpFactor);
    // Core is always white or very light version of the color
    const coreColor = color.clone().lerp(new THREE.Color("#ffffff"), 0.8);
    (coreRef.current.material as THREE.MeshBasicMaterial).color.lerp(coreColor, lerpFactor);
  });

  return (
    <group>
      {/* Outer Halo - Large, very transparent, additive blending */}
      <Sphere args={[1.5, 64, 64]} ref={outerHaloRef}>
        <meshBasicMaterial 
          color="#00e5ff" 
          transparent={true} 
          opacity={0.15} 
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </Sphere>

      {/* Inner Halo - Medium density, additive blending */}
      <Sphere args={[1, 64, 64]} ref={innerHaloRef}>
        <meshBasicMaterial 
          color="#00e5ff" 
          transparent={true} 
          opacity={0.3} 
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </Sphere>
      
      {/* Core - Solid intense light source at the center */}
      <Sphere args={[0.5, 32, 32]} ref={coreRef}>
        <meshBasicMaterial 
          color="#ffffff" 
          transparent={true}
          opacity={0.9}
        />
      </Sphere>
    </group>
  );
}
