/**
 * 生活手绘注释图 — 客户端生成引擎
 * 遵循小红书日常随手记录风格 Prompt（见 SKETCH_PROMPT）
 */
(function () {
  'use strict';

  var SKETCH_PROMPT =
    '基于用户上传的原始照片，为图片添加手绘风格注释与装饰。' +
    '统一白色细线条、一笔画松弛风格、沿物体边缘轻描轮廓；' +
    '适量箭头虚线；中文手写字体、口语化碎碎念；' +
    '饮品写味道温度感受，食物写口感，环境写氛围，收尾一句总结感悟；' +
    '少量热气星星爱心表情；整体松弛自然不精致。';

  var COPY = {
    drink: ['冰冰的，好清爽', '一口下去，有点醒神', '温温的，挺治愈', '甜度刚好，不腻'],
    food: ['软软的，有点惊喜', '香香的，忍不住再来一口', '外酥里嫩，刚刚好', '随便一口，都很满足'],
    env: ['有点安静，很适合发呆', '光洒进来，心情都慢了', '角落的氛围，刚刚好', '待在这里，不想赶时间'],
    summary: ['今天也算被治愈了', '就这样，慢一点点也很好', '普通的一天，也值得记录', '这一刻，先放轻松吧'],
  };

  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var MAX_SIDE = 1400;

  var $fileInput, $uploadZone, $btnGenerate, $status, $results, $originalImg, $generatedImg;
  var $btnDownload, $elementsBox, $apiProxy, $siteToken, $modeCloud, $modeLocal, $genHint;
  var currentFile = null;
  var generatedDataUrl = null;
  var POLL_INTERVAL_MS = 2000;
  var POLL_MAX = 90;

  function $(id) {
    return document.getElementById(id);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new Error('图片尺寸无效'));
          return;
        }
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('图片解码失败'));
      };
      img.src = dataUrl;
    });
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('无法读取图片文件'));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromBitmap(file) {
    if (typeof createImageBitmap !== 'function') {
      return Promise.reject(new Error('浏览器不支持该图片格式'));
    }
    return createImageBitmap(file)
      .then(function (bitmap) {
        var canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        if (bitmap.close) bitmap.close();
        return canvas.toDataURL('image/png');
      })
      .then(loadImageFromDataUrl);
  }

  /** 使用 data: URL 加载，避免 Service Worker 破坏 blob: URL */
  function loadImageFromFile(file) {
    return fileToDataUrl(file)
      .then(loadImageFromDataUrl)
      .catch(function () {
        return loadImageFromBitmap(file);
      })
      .catch(function () {
        throw new Error('图片加载失败，请改用 JPG 或 PNG 后重试');
      });
  }

  function scaleSize(w, h) {
    if (Math.max(w, h) <= MAX_SIDE) return { w: w, h: h };
    var s = MAX_SIDE / Math.max(w, h);
    return { w: Math.round(w * s), h: Math.round(h * s) };
  }

  function sobelEdges(imageData, w, h) {
    var data = imageData.data;
    var gray = new Float32Array(w * h);
    var i, x, y, idx, r, g, b;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        idx = (y * w + x) * 4;
        r = data[idx];
        g = data[idx + 1];
        b = data[idx + 2];
        gray[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }
    var mag = new Float32Array(w * h);
    var gx, gy, m, threshold = 42;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        gx =
          -gray[(y - 1) * w + (x - 1)] +
          gray[(y - 1) * w + (x + 1)] -
          2 * gray[y * w + (x - 1)] +
          2 * gray[y * w + (x + 1)] -
          gray[(y + 1) * w + (x - 1)] +
          gray[(y + 1) * w + (x + 1)];
        gy =
          -gray[(y - 1) * w + (x - 1)] -
          2 * gray[(y - 1) * w + x] -
          gray[(y - 1) * w + (x + 1)] +
          gray[(y + 1) * w + (x - 1)] +
          2 * gray[(y + 1) * w + x] +
          gray[(y + 1) * w + (x + 1)];
        m = Math.sqrt(gx * gx + gy * gy);
        mag[y * w + x] = m > threshold ? m : 0;
      }
    }
    return mag;
  }

  function sampleEdgePoints(mag, w, h, count) {
    var points = [];
    var step = Math.max(4, Math.floor(Math.sqrt((w * h) / (count * 3))));
    var x, y, i, v;
    for (y = step; y < h - step; y += step) {
      for (x = step; x < w - step; x += step) {
        v = mag[y * w + x];
        if (v > 0 && Math.random() < 0.35) {
          points.push({
            x: x + (Math.random() - 0.5) * step * 0.6,
            y: y + (Math.random() - 0.5) * step * 0.6,
          });
        }
      }
    }
    while (points.length < count && points.length < 800) {
      x = step + Math.floor(Math.random() * (w - 2 * step));
      y = step + Math.floor(Math.random() * (h - 2 * step));
      if (mag[y * w + x] > 0) points.push({ x: x, y: y });
    }
    return points.slice(0, count);
  }

  function wobble(a, b, t, amp) {
    var mx = a.x + (b.x - a.x) * t;
    var my = a.y + (b.y - a.y) * t;
    mx += Math.sin(t * 12) * amp;
    my += Math.cos(t * 10) * amp;
    return { x: mx, y: my };
  }

  function drawSketchStroke(ctx, a, b) {
    var steps = 8 + Math.floor(Math.random() * 6);
    var amp = 1.2 + Math.random() * 2;
    var i, p;
    ctx.beginPath();
    p = wobble(a, b, 0, amp);
    ctx.moveTo(p.x, p.y);
    for (i = 1; i <= steps; i++) {
      p = wobble(a, b, i / steps, amp);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function drawDashedLine(ctx, a, b) {
    ctx.setLineDash([6, 8]);
    drawSketchStroke(ctx, a, b);
    ctx.setLineDash([]);
  }

  function drawArrow(ctx, from, to) {
    var angle = Math.atan2(to.y - from.y, to.x - from.x);
    var len = 10;
    drawSketchStroke(ctx, from, to);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - len * Math.cos(angle - 0.45), to.y - len * Math.sin(angle - 0.45));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - len * Math.cos(angle + 0.45), to.y - len * Math.sin(angle + 0.45));
    ctx.stroke();
  }

  function drawDecorations(ctx, w, h) {
    var spots = [
      { x: w * 0.12, y: h * 0.15, type: 'star' },
      { x: w * 0.88, y: h * 0.2, type: 'heart' },
      { x: w * 0.78, y: h * 0.75, type: 'smile' },
    ];
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    spots.forEach(function (s) {
      if (s.type === 'star') {
        ctx.font = '18px sans-serif';
        ctx.fillText('✦', s.x, s.y);
      } else if (s.type === 'heart') {
        ctx.font = '16px sans-serif';
        ctx.fillText('♥', s.x, s.y);
      } else {
        ctx.font = '14px sans-serif';
        ctx.fillText(':)', s.x, s.y);
      }
    });
    drawSteam(ctx, w * 0.25, h * 0.35);
    ctx.restore();
  }

  function drawSteam(ctx, x, y) {
    var i;
    ctx.beginPath();
    for (i = 0; i < 3; i++) {
      ctx.moveTo(x + i * 8, y);
      ctx.quadraticCurveTo(x + i * 8 + 4, y - 18 - i * 4, x + i * 8 + 8, y - 28 - i * 6);
    }
    ctx.stroke();
  }

  function drawLabel(ctx, text, x, y, maxW) {
    ctx.save();
    ctx.font = '22px "Ma Shan Zheng", "STKaiti", "KaiTi", cursive';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    ctx.textBaseline = 'middle';
    var lines = wrapText(ctx, text, maxW);
    var lineH = 28;
    var startY = y - ((lines.length - 1) * lineH) / 2;
    lines.forEach(function (line, i) {
      ctx.strokeText(line, x, startY + i * lineH);
      ctx.fillText(line, x, startY + i * lineH);
    });
    ctx.restore();
  }

  function wrapText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return [text];
    var chars = text.split('');
    var line = '';
    var lines = [];
    chars.forEach(function (ch) {
      var test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [text];
  }

  function defaultAnalysis() {
    return {
      elements: ['饮品', '小食', '窗边', '阳光'],
      labels: [
        { text: pick(COPY.drink), x: 0.08, y: 0.22, type: 'drink' },
        { text: pick(COPY.food), x: 0.55, y: 0.38, type: 'food' },
        { text: pick(COPY.env), x: 0.1, y: 0.62, type: 'env' },
        { text: pick(COPY.summary), x: 0.5, y: 0.88, type: 'summary' },
      ],
    };
  }

  function renderAnnotated(img, analysis) {
    var size = scaleSize(img.width, img.height);
    var w = size.w;
    var h = size.h;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    var tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0, w, h);
    var id = tctx.getImageData(0, 0, w, h);
    var mag = sobelEdges(id, w, h);
    var points = sampleEdgePoints(mag, w, h, Math.min(120, Math.floor((w * h) / 8000)));

    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a, b;
    for (i = 0; i < points.length - 1; i += 2) {
      a = points[i];
      b = points[i + 1];
      if (!b) break;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 120) drawSketchStroke(ctx, a, b);
    }

    if (points.length > 4) {
      drawArrow(ctx, { x: w * 0.15, y: h * 0.5 }, points[Math.floor(points.length * 0.3)]);
      drawDashedLine(ctx, { x: w * 0.7, y: h * 0.25 }, points[Math.floor(points.length * 0.6)]);
    }

    analysis.labels.forEach(function (lb) {
      var px = (lb.x != null ? lb.x : 0.1) * w;
      var py = (lb.y != null ? lb.y : 0.5) * h;
      drawLabel(ctx, lb.text, px, py, w * 0.38);
    });

    drawDecorations(ctx, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), analysis: analysis };
  }

  function setStatus(msg, loading) {
    if (loading) {
      $status.innerHTML = '<span class="sketch-spinner"></span>' + msg;
    } else {
      $status.textContent = msg;
    }
  }

  function getApiBase() {
    var fromInput = $apiProxy && $apiProxy.value.trim();
    if (fromInput) return fromInput.replace(/\/$/, '');
    var cfg = window.SKETCH_CONFIG || {};
    if (cfg.apiUrl) return String(cfg.apiUrl).replace(/\/$/, '');
    return '';
  }

  function getAuthHeaders() {
    var token =
      ($siteToken && $siteToken.value.trim()) || sessionStorage.getItem('sketch_site_token') || '';
    if (!token) return {};
    return { Authorization: 'Bearer ' + token };
  }

  function isCloudMode() {
    return $modeCloud && $modeCloud.checked;
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollReplicateJob(apiBase, jobId, headers) {
    var attempts = 0;
    function tick() {
      attempts += 1;
      return fetch(apiBase + '/api/status?id=' + encodeURIComponent(jobId), { headers: headers })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || '查询任务失败');
            return data;
          });
        })
        .then(function (data) {
          if (data.status === 'succeeded' && data.imageUrl) return data;
          if (data.status === 'failed') throw new Error(data.error || '云端生成失败');
          if (attempts >= POLL_MAX) throw new Error('生成超时，请稍后重试');
          setStatus('云端生成中…（' + attempts + '/' + POLL_MAX + '）', true);
          return delay(POLL_INTERVAL_MS).then(tick);
        });
    }
    return tick();
  }

  function generateWithCloudProxy(file) {
    var apiBase = getApiBase();
    if (!apiBase) {
      return Promise.reject(new Error('未配置 Worker API 地址，请在高级设置或 _config.yml 中填写 sketch_api_url'));
    }
    var headers = getAuthHeaders();
    var form = new FormData();
    form.append('image', file);

    setStatus('正在上传并提交云端任务…', true);
    return fetch(apiBase + '/api/annotate', {
      method: 'POST',
      headers: headers,
      body: form,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || '提交失败');
          return data;
        });
      })
      .then(function (data) {
        setStatus('任务已创建，等待大模型生成…', true);
        return pollReplicateJob(apiBase, data.jobId, headers);
      })
      .then(function (data) {
        var imageUrl = data.imageUrl;
        var fetchUrl = data.proxyUrl ? apiBase + data.proxyUrl : imageUrl;
        return fetch(fetchUrl, { headers: headers }).then(function (res) {
          if (!res.ok) throw new Error('获取生成图失败');
          return res.blob();
        }).then(function (blob) {
          return fileToDataUrl(
            new File([blob], 'generated.png', { type: blob.type || 'image/png' }),
          ).then(function (dataUrl) {
            return {
              generatedUrl: dataUrl,
              elements: ['云端 Replicate 生成'],
              modeLabel: '云端大模型改图（' + (window.SKETCH_CONFIG && window.SKETCH_CONFIG.apiUrl ? 'Worker' : apiBase) + '）',
            };
          });
        });
      });
  }

  function generateLocal(file) {
    return loadImageFromFile(file).then(function (img) {
      var analysis = defaultAnalysis();
      return fileToDataUrl(file).then(function (originalDataUrl) {
        var result = renderAnnotated(img, analysis);
        return {
          originalUrl: originalDataUrl,
          generatedUrl: result.dataUrl,
          analysis: result.analysis,
          modeLabel: '本地浏览器引擎',
        };
      });
    });
  }

  function showResults(originalUrl, generatedUrl, analysis, modeLabel) {
    $originalImg.src = originalUrl;
    $generatedImg.src = generatedUrl;
    generatedDataUrl = generatedUrl;
    $elementsBox.textContent =
      '识别元素：' +
      (analysis.elements || []).join('、') +
      ' · 方式：' +
      (modeLabel || '') +
      ' · 规则：' +
      SKETCH_PROMPT.slice(0, 36) +
      '…';
    if ($genHint) $genHint.textContent = '生成方式：' + (modeLabel || '');
    $results.classList.add('is-visible');
    $btnDownload.href = generatedUrl;
  }

  function onGenerate() {
    if (!currentFile) {
      setStatus('请先选择一张图片');
      return;
    }
    $btnGenerate.disabled = true;
    setStatus('正在生成手绘注释图…', true);

    var useCloud = isCloudMode() && getApiBase();

    if (isCloudMode() && !getApiBase()) {
      setStatus('未配置 Worker 地址，已自动改用本地生成');
      useCloud = false;
    }

    var originalDataUrlPromise = fileToDataUrl(currentFile);

    var pipeline = useCloud
      ? originalDataUrlPromise.then(function (originalDataUrl) {
          return generateWithCloudProxy(currentFile).then(function (payload) {
            return {
              originalUrl: originalDataUrl,
              generatedUrl: payload.generatedUrl,
              analysis: { elements: payload.elements },
              modeLabel: payload.modeLabel,
            };
          });
        })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        var isConfig =
          msg.indexOf('REPLICATE_API_TOKEN') >= 0 ||
          msg.indexOf('Unauthorized') >= 0 ||
          msg.indexOf('未配置') >= 0;
        if (isConfig) {
          throw new Error(
            msg +
              '。请在 Worker 目录执行：npx wrangler secret put REPLICATE_API_TOKEN',
          );
        }
        setStatus('云端失败（' + msg + '），正在本地生成…', true);
        return generateLocal(currentFile).then(function (local) {
          local.modeLabel = '本地引擎（云端降级）';
          return local;
        });
      })
      : originalDataUrlPromise.then(function (originalDataUrl) {
          return generateLocal(currentFile).then(function (local) {
            local.originalUrl = originalDataUrl;
            return local;
          });
        });

    pipeline
      .then(function (payload) {
        showResults(
          payload.originalUrl,
          payload.generatedUrl,
          payload.analysis,
          payload.modeLabel,
        );
        setStatus('生成完成，可下载保存第二张图');
      })
      .catch(function (err) {
        setStatus('生成失败：' + (err.message || '未知错误'));
      })
      .finally(function () {
        $btnGenerate.disabled = false;
      });
  }

  function syncModeFromConfig() {
    var hasApi = !!getApiBase();
    if ($modeCloud) {
      $modeCloud.disabled = !hasApi;
      if (!hasApi) $modeCloud.checked = false;
    }
    if (!hasApi && $modeLocal) $modeLocal.checked = true;
  }

  function onFileSelected(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setStatus('请选择图片文件（JPG、PNG 等）');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('图片不能超过 10MB');
      return;
    }
    currentFile = file;
    setStatus('已选择：' + file.name + '，点击「生成手绘注释图」');
    $btnGenerate.disabled = false;
    $results.classList.remove('is-visible');
  }

  function init() {
    $fileInput = $('sketch-file-input');
    $uploadZone = $('sketch-upload-zone');
    $btnGenerate = $('sketch-btn-generate');
    $status = $('sketch-status');
    $results = $('sketch-results');
    $originalImg = $('sketch-img-original');
    $generatedImg = $('sketch-img-generated');
    $btnDownload = $('sketch-btn-download');
    $elementsBox = $('sketch-elements');
    $apiProxy = $('sketch-api-proxy');
    $siteToken = $('sketch-site-token');
    $modeCloud = $('sketch-mode-cloud');
    $modeLocal = $('sketch-mode-local');
    $genHint = $('sketch-gen-mode-hint');

    if (!$fileInput) return;

    syncModeFromConfig();

    $uploadZone.addEventListener('click', function () {
      $fileInput.click();
    });

    $fileInput.addEventListener('change', function () {
      onFileSelected($fileInput.files[0]);
    });

    $uploadZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      $uploadZone.classList.add('is-dragover');
    });
    $uploadZone.addEventListener('dragleave', function () {
      $uploadZone.classList.remove('is-dragover');
    });
    $uploadZone.addEventListener('drop', function (e) {
      e.preventDefault();
      $uploadZone.classList.remove('is-dragover');
      if (e.dataTransfer.files[0]) onFileSelected(e.dataTransfer.files[0]);
    });

    $btnGenerate.addEventListener('click', onGenerate);

    if ($siteToken) {
      var savedToken = sessionStorage.getItem('sketch_site_token');
      if (savedToken) $siteToken.value = savedToken;
      $siteToken.addEventListener('change', function () {
        sessionStorage.setItem('sketch_site_token', $siteToken.value.trim());
      });
    }

    if ($apiProxy) {
      $apiProxy.addEventListener('change', syncModeFromConfig);
    }

    $btnGenerate.disabled = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
