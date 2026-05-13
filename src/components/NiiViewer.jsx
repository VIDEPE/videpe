import { useRef, useEffect } from "react";
import { Niivue } from "@niivue/niivue";

const NiiVue = ({ imageUrl }) => {
  const canvas = useRef();
  const nvRef = useRef();
  useEffect(() => {
    const volumeList = [
      {
        url: imageUrl,
      },
    ];
    async function setupAndLoad() {
      const nv = new Niivue();
      nv.attachToCanvas(canvas.current);
      await nv.loadVolumes(volumeList);
      const nvRef.current = nv
    }
    setupAndLoad()
  }, [imageUrl]);

  return <canvas ref={canvas} height={480} width={640} />;
};