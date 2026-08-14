// Safe payment-app launcher and local screenshot editor. APK build 1.
(() => {
  const input = document.querySelector('#imageInput');
  const dialog = document.querySelector('#cropDialog');
  const stage = document.querySelector('#cropStage');
  const canvas = document.querySelector('#cropCanvas');
  const zoomInput = document.querySelector('#cropZoom');
  const ctx = canvas.getContext('2d');
  let img = null;
  let zoom = 1;
  let rotation = 0;
  let offsetX = 0;
  let offsetY = 0;
  let baseScale = 1;
  const pointers = new Map();
  let lastCenter = null;
  let lastDistance = 0;

  function fitImage() {
    if (!img) return;
    const r = stage.getBoundingClientRect();
    const rotated = Math.abs(rotation % 180) === 90;
    const iw = rotated ? img.height : img.width;
    const ih = rotated ? img.width : img.height;
    baseScale = Math.max(r.width * .84 / iw, r.height * .84 / ih);
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    zoomInput.value = 1;
    draw();
  }

  function draw() {
    if (!img) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(r.width / 2 + offsetX, r.height / 2 + offsetY);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.scale(baseScale * zoom, baseScale * zoom);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      URL.revokeObjectURL(url);
      img = next;
      rotation = 0;
      dialog.showModal();
      requestAnimationFrame(fitImage);
    };
    next.onerror = () => { URL.revokeObjectURL(url); toast('无法读取这张图片'); };
    next.src = url;
  }

  input.onchange = e => {
    loadFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  };

  zoomInput.oninput = () => { zoom = Number(zoomInput.value); draw(); };
  document.querySelector('#rotateLeft').onclick = () => { rotation = (rotation - 90) % 360; fitImage(); };
  document.querySelector('#rotateRight').onclick = () => { rotation = (rotation + 90) % 360; fitImage(); };
  document.querySelector('#resetCrop').onclick = fitImage;
  document.querySelector('#cancelCrop').onclick = () => { dialog.close(); img = null; };

  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  });
  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
    const pts = [...pointers.values()];
    const center = pts.length > 1 ? {x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2} : pts[0];
    if (lastCenter) { offsetX += center.x-lastCenter.x; offsetY += center.y-lastCenter.y; }
    if (pts.length > 1) {
      const distance = Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      if (lastDistance) zoom = Math.max(1,Math.min(4,zoom*distance/lastDistance));
      lastDistance=distance; zoomInput.value=zoom;
    }
    lastCenter=center; draw();
  });
  function release(e){pointers.delete(e.pointerId);lastCenter=null;lastDistance=0;}
  stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);

  document.querySelector('#confirmCrop').onclick = () => {
    if (!img) return;
    const sx = Math.round(canvas.width * .08), sy = Math.round(canvas.height * .08);
    const sw = Math.round(canvas.width * .84), sh = Math.round(canvas.height * .84);
    const out = document.createElement('canvas'); out.width=sw; out.height=sh;
    out.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
    out.toBlob(blob => {
      if (!blob) return toast('图片裁剪失败，请重试');
      dialog.close(); img=null; recognize(blob);
    },'image/jpeg',.94);
  };

  function launch(kind) {
    const name = kind === 'wechat' ? '微信' : '支付宝';
    const route = kind === 'wechat' ? '我 → 服务 → 钱包 → 账单' : '我的 → 账单';
    if (!confirm(`即将打开${name}。\n\n账单入口：${route}\n\n本应用不会读取你的账号、密码或账单数据。请打开账单并截图，然后返回本应用选择截图。是否继续？`)) return;
    if (window.Android && typeof window.Android.openApp === 'function') {
      window.Android.openApp(kind);
    } else {
      toast(`请在${name}中进入账单页面，截图后再返回`);
      location.href = kind === 'wechat' ? 'weixin://' : 'alipays://platformapi/startapp';
    }
  }
  document.querySelector('#openWechat').onclick=()=>launch('wechat');
  document.querySelector('#openAlipay').onclick=()=>launch('alipay');
  window.addEventListener('resize',draw);
})();
