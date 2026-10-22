// Dependency-free confetti burst, shared across engine views. Spawns a
// full-screen overlay canvas, rains particles down under gravity, then
// removes itself — call window.launchConfetti() from any view's app.js.
(function () {
  const COLORS = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45aaf2', '#a685e2', '#ffffff'];

  function launchConfetti({ particleCount = 140, duration = 2400, originY = 0.15 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * canvas.width,
      y: canvas.height * originY - Math.random() * 60,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * -4 - 2,
      rotation: Math.random() * 360,
      vr: (Math.random() - 0.5) * 14,
      size: Math.random() * 7 + 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() < 0.5 ? 'rect' : 'circle',
    }));

    const gravity = 0.18;
    const drag = 0.995;
    const startedAt = Date.now();

    function frame() {
      const elapsed = Date.now() - startedAt;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.vy += gravity;
        p.vx *= drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < duration) {
        requestAnimationFrame(frame);
      } else {
        window.removeEventListener('resize', resize);
        canvas.remove();
      }
    }

    requestAnimationFrame(frame);
  }

  window.launchConfetti = launchConfetti;
})();
