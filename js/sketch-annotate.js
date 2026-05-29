/**
 * 生活手绘注释图 — 客户端生成引擎
 * 遵循小红书日常随手记录风格 Prompt（见 SKETCH_PROMPT）
 */
(function () {
  'use strict';

  var SKETCH_PROMPT =
    '观察照片元素，为每个元素添加有意义的手绘注释。' +
    '白色细线手绘、沿物体边缘描轮廓；中文手写口语短句；小红书随手记录风格。';

  var COPY = {
    drink: ['冰冰的，好清爽', '一口下去，有点醒神', '温温的，挺治愈', '甜度刚好，不腻'],
    food: ['软软的，有点惊喜', '香香的，忍不住再来一口', '外酥里嫩，刚刚好', '随便一口，都很满足'],
    env: ['有点安静，很适合发呆', '光洒进来，心情都慢了', '角落的氛围，刚刚好', '待在这里，不想赶时间'],
    summary: ['今天也算被治愈了', '就这样，慢一点点也很好', '普通的一天，也值得记录', '这一刻，先放轻松吧'],
  };

  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var MAX_SIDE = 1400;

  var $fileInput, $uploadZone, $btnUpload, $previewList, $btnGenerate, $status, $results, $originalImg, $generatedImg;
  var $btnDownload, $elementsBox, $apiProxy, $siteToken, $genHint;
  var $currentFileBox, $currentFileName, $currentFileDetail;
  var currentFile = null;
  var uploadedFiles = [];
  var selectedFileId = null;
  var fileIdCounter = 0;
  var generatedDataUrl = null;
  var POLL_INTERVAL_MS = 3000;
  var POLL_MAX = 120;
  var GENERATE_WAIT_HINT_MS = 3000;
  /** 内联 data URL 过大时改走 blob URL，避免移动端无法显示 */
  var MAX_INLINE_DATA_URL_CHARS = 1500000;

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
    var gx, gy, m, threshold = 32;
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
        if (v > 0 && Math.random() < 0.48) {
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
    var points = sampleEdgePoints(mag, w, h, Math.min(200, Math.floor((w * h) / 5500)));

    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a, b;
    for (i = 0; i < points.length - 1; i += 2) {
      a = points[i];
      b = points[i + 1];
      if (!b) break;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 150) drawSketchStroke(ctx, a, b);
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

  function formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function updateCurrentFileDisplay() {
    if (!$currentFileBox || !$currentFileName || !$currentFileDetail) return;
    if (!currentFile) {
      $currentFileBox.classList.add('is-empty');
      $currentFileName.textContent = '尚未选择图片';
      $currentFileDetail.textContent = '支持 JPG、PNG，单张最大 10MB · 可多选';
      return;
    }
    $currentFileBox.classList.remove('is-empty');
    $currentFileName.textContent = currentFile.name;
    var detail = formatFileSize(currentFile.size);
    if (uploadedFiles.length > 1) {
      detail += ' · 共 ' + uploadedFiles.length + ' 张，点击缩略图切换';
    }
    $currentFileDetail.textContent = detail;
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

  function isBillingError(msg) {
    return /insufficient credit|billing|余额不足|充值|openrouter\.ai\/credits/i.test(msg || '');
  }

  function isConfigError(msg) {
    return (
      /OPENROUTER_API_KEY|REPLICATE_API_TOKEN|Unauthorized|未配置 Worker|User not found|API Key 无效|invalid.*key|JPG\/PNG|图片格式/i.test(
        msg || '',
      )
    );
  }

  function getAuthHeaders() {
    var token =
      ($siteToken && $siteToken.value.trim()) || sessionStorage.getItem('sketch_site_token') || '';
    if (!token) return {};
    return { Authorization: 'Bearer ' + token };
  }

  var MODEL_LABELS = {
    'bytedance-seed/seedream-4.5': '豆包 Seedream 4.5',
    'google/gemini-3-pro-image-preview': 'Nano Banana Pro',
  };

  function getSelectedModelId() {
    var checked = document.querySelector('input[name="sketch-model"]:checked');
    return checked ? checked.value : 'bytedance-seed/seedream-4.5';
  }

  function getSelectedModelLabel() {
    return MODEL_LABELS[getSelectedModelId()] || getSelectedModelId();
  }

  function persistModelChoice() {
    try {
      sessionStorage.setItem('sketch_model', getSelectedModelId());
    } catch (e) {
      /* ignore */
    }
  }

  function restoreModelChoice() {
    var saved;
    try {
      saved = sessionStorage.getItem('sketch_model');
    } catch (e) {
      saved = '';
    }
    if (!saved || !MODEL_LABELS[saved]) return;
    var input = document.querySelector('input[name="sketch-model"][value="' + saved + '"]');
    if (input) input.checked = true;
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollCloudJob(apiBase, jobId, headers) {
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
          if (data.status === 'succeeded') {
            if (data.imageFetchUrl) return data;
            if (data.imageDataUrl) return data;
            if (data.imageUrl) return data;
          }
          if (data.status === 'failed') throw new Error(data.error || '云端生成失败');
          if (attempts >= POLL_MAX) {
            throw new Error('生成超时（已等待约 ' + Math.round((attempts * POLL_INTERVAL_MS) / 60000) + ' 分钟），请稍后重试');
          }
          setStatus('云端生成中…（' + attempts + '/' + POLL_MAX + '）', true);
          return delay(POLL_INTERVAL_MS).then(tick);
        });
    }
    return tick();
  }

  function cloudPayloadToResult(generatedUrl, modelLabel) {
    return {
      generatedUrl: generatedUrl,
      elements: [modelLabel + ' 云端生成'],
      modeLabel: modelLabel + ' 改图（保真原图 + 手绘注释）',
    };
  }

  function fetchGeneratedBlob(fetchPath, apiBase, headers) {
    var authHeaders = headers || getAuthHeaders();
    var fullUrl =
      /^https?:\/\//i.test(fetchPath) ? fetchPath : apiBase + fetchPath;
    return fetch(fullUrl, { headers: authHeaders }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            throw new Error(body.error || '获取生成图失败（HTTP ' + res.status + '）');
          });
      }
      return res.blob();
    });
  }

  function cloudResultFromStatus(data, apiBase, headers) {
    var modelLabel = MODEL_LABELS[data.model] || getSelectedModelLabel();
    var authHeaders = headers || getAuthHeaders();

    if (data.imageFetchUrl) {
      return fetchGeneratedBlob(data.imageFetchUrl, apiBase, authHeaders).then(function (blob) {
        return cloudPayloadToResult(URL.createObjectURL(blob), modelLabel);
      });
    }

    function resolveRemoteImage(remoteUrl) {
      var proxy =
        apiBase +
        '/api/proxy-image?url=' +
        encodeURIComponent(remoteUrl);
      return fetch(proxy, { headers: authHeaders })
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () {
              return {};
            }).then(function (body) {
              throw new Error(body.error || '获取生成图失败（HTTP ' + res.status + '）');
            });
          }
          return res.blob();
        })
        .then(function (blob) {
          return fileToDataUrl(new File([blob], 'generated.png', { type: blob.type || 'image/png' }));
        })
        .then(function (dataUrl) {
          return cloudPayloadToResult(dataUrl, modelLabel);
        });
    }

    if (data.imageDataUrl) {
      if (/^https?:\/\//i.test(data.imageDataUrl)) {
        return resolveRemoteImage(data.imageDataUrl);
      }
      if (data.imageDataUrl.length > MAX_INLINE_DATA_URL_CHARS) {
        return fetch(data.imageDataUrl)
          .then(function (res) {
            if (!res.ok) throw new Error('生成图解码失败');
            return res.blob();
          })
          .then(function (blob) {
            return cloudPayloadToResult(URL.createObjectURL(blob), modelLabel);
          });
      }
      return Promise.resolve(cloudPayloadToResult(data.imageDataUrl, modelLabel));
    }

    var imageUrl = data.imageUrl;
    if (!imageUrl) {
      return Promise.reject(new Error('云端未返回图片数据'));
    }
    var fetchUrl = data.proxyUrl ? apiBase + data.proxyUrl : imageUrl;
    if (!/^https?:\/\//i.test(fetchUrl) && fetchUrl.indexOf('/api/proxy-image') === -1) {
      return Promise.reject(new Error('云端返回的图片地址无效'));
    }
    return fetch(fetchUrl, { headers: authHeaders })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () {
            return {};
          }).then(function (body) {
            throw new Error(body.error || '获取生成图失败（HTTP ' + res.status + '）');
          });
        }
        return res.blob();
      })
      .then(function (blob) {
        return fileToDataUrl(new File([blob], 'generated.png', { type: blob.type || 'image/png' }));
      })
      .then(function (dataUrl) {
        return cloudPayloadToResult(dataUrl, modelLabel);
      });
  }

  function resizeFileForCloud(file) {
    return loadImageFromFile(file).then(function (img) {
      var size = scaleSize(img.width, img.height);
      var canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.drawImage(img, 0, 0, size.w, size.h);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(
          function (blob) {
            if (!blob) {
              canvas.toBlob(function (pngBlob) {
                if (!pngBlob) {
                  reject(new Error('图片压缩失败，请改用 JPG 或 PNG'));
                  return;
                }
                resolve(
                  new File([pngBlob], file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' }),
                );
              }, 'image/png');
              return;
            }
            resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.88,
        );
      });
    });
  }

  function generateWithCloudProxy(file) {
    var apiBase = getApiBase();
    if (!apiBase) {
      return Promise.reject(new Error('未配置 Worker API 地址，请在高级设置或 _config.yml 中填写 sketch_api_url'));
    }
    var headers = getAuthHeaders();
    var modelId = getSelectedModelId();
    var modelLabel = getSelectedModelLabel();

    setStatus('正在压缩并上传图片（' + modelLabel + '）…', true);
    return resizeFileForCloud(file).then(function (sizedFile) {
      var form = new FormData();
      form.append('image', sizedFile);
      form.append('model', modelId);

      var waitStarted = Date.now();
      var waitTicker = setInterval(function () {
        var secs = Math.floor((Date.now() - waitStarted) / 1000);
        setStatus(modelLabel + ' 生成中…已等待 ' + secs + ' 秒，请勿关闭页面', true);
      }, GENERATE_WAIT_HINT_MS);

      return fetch(apiBase + '/api/annotate', {
        method: 'POST',
        headers: headers,
        body: form,
      })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (parseErr) {
            if (res.ok) {
              throw new Error(
                '服务端返回的 JSON 过大或已截断，请重新部署 Worker 后重试（豆包 2K 图建议使用最新版 API）',
              );
            }
            throw new Error('提交失败（HTTP ' + res.status + '）');
          }
          var hasImage =
            data.imageFetchUrl || data.imageDataUrl || data.imageUrl;
          if (!res.ok && data.status !== 'succeeded') {
            throw new Error(data.error || '提交失败（HTTP ' + res.status + '）');
          }
          if (!res.ok && data.status === 'succeeded' && hasImage) {
            return data;
          }
          if (!res.ok) {
            throw new Error(data.error || '提交失败（HTTP ' + res.status + '）');
          }
          return data;
        });
      })
      .finally(function () {
        clearInterval(waitTicker);
      })
      .then(function (data) {
        if (data.status === 'succeeded') {
          if (data.imageFetchUrl || data.imageDataUrl || data.imageUrl) {
            return cloudResultFromStatus(data, apiBase, headers);
          }
          throw new Error('云端返回成功但未包含图片，请强制刷新页面后重试');
        }
        if (!data.jobId) {
          throw new Error(data.error || '提交失败');
        }
        setStatus('任务已创建，' + modelLabel + ' 生成中…', true);
        return pollCloudJob(apiBase, data.jobId, headers).then(function (pollData) {
          return cloudResultFromStatus(pollData, apiBase, headers);
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
    var parts = [
      '识别元素：' + (analysis.elements || []).join('、'),
      '方式：' + (modeLabel || ''),
    ];
    if (analysis.cloudNote) parts.push(analysis.cloudNote);
    parts.push('规则：' + SKETCH_PROMPT.slice(0, 36) + '…');
    $elementsBox.textContent = parts.join(' · ');
    if ($genHint) $genHint.textContent = '生成方式：' + (modeLabel || '');
    $results.classList.add('is-visible');
    $btnDownload.href = generatedUrl;
  }

  function onGenerate() {
    if (window.SketchAuth && !window.SketchAuth.isLoggedIn()) {
      setStatus('请先登录后再生成（GitHub 或游客身份均可）');
      return;
    }
    if (!currentFile) {
      setStatus('请先选择一张图片');
      return;
    }
    if (!getApiBase()) {
      setStatus('未配置 Worker 地址，请在高级设置或 _config.yml 中填写 sketch_api_url');
      return;
    }

    $btnGenerate.disabled = true;
    setStatus('正在使用 ' + getSelectedModelLabel() + ' 生成手绘注释图…', true);

    if (window.SketchAuth && window.SketchAuth.incrementDrawCount) {
      window.SketchAuth.incrementDrawCount();
    }

    fileToDataUrl(currentFile)
      .then(function (originalDataUrl) {
        return generateWithCloudProxy(currentFile).then(function (payload) {
          return {
            originalUrl: originalDataUrl,
            generatedUrl: payload.generatedUrl,
            analysis: { elements: payload.elements },
            modeLabel: payload.modeLabel,
          };
        });
      })
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
        var msg = err && err.message ? err.message : String(err);
        if (isConfigError(msg)) {
          setStatus(
            msg + '。请在 Worker 目录执行：npx wrangler secret put OPENROUTER_API_KEY',
          );
        } else if (isBillingError(msg)) {
          setStatus('OpenRouter 余额不足，请前往 openrouter.ai/credits 充值后再试');
        } else {
          setStatus('生成失败：' + msg);
        }
      })
      .finally(function () {
        $btnGenerate.disabled = false;
      });
  }

  function syncModeFromConfig() {
    var hasApi = !!getApiBase();
    var modelInputs = document.querySelectorAll('input[name="sketch-model"]');
    for (var i = 0; i < modelInputs.length; i += 1) {
      modelInputs[i].disabled = !hasApi;
    }
    if (!hasApi) {
      setStatus('未配置 Worker 地址，请在高级设置中填写 API 根地址');
    }
  }

  function addUploadedFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      setStatus('请选择图片文件（JPG、PNG 等）');
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('「' + file.name + '」超过 10MB，已跳过');
      return false;
    }
    var id = 'f-' + ++fileIdCounter;
    uploadedFiles.push({
      id: id,
      file: file,
      url: URL.createObjectURL(file),
      name: file.name,
    });
    selectUploadedFile(id);
    renderPreviewList();
    updateCurrentFileDisplay();
    $results.classList.remove('is-visible');
    return true;
  }

  function addUploadedFiles(fileList) {
    var added = 0;
    for (var i = 0; i < fileList.length; i += 1) {
      if (addUploadedFile(fileList[i])) added += 1;
    }
    if (added > 0) {
      updateCurrentFileDisplay();
      setStatus('已添加 ' + added + ' 张图片，当前：' + currentFile.name);
    }
  }

  function selectUploadedFile(id) {
    var item = uploadedFiles.find(function (f) {
      return f.id === id;
    });
    if (!item) return;
    selectedFileId = id;
    currentFile = item.file;
    $btnGenerate.disabled = false;
    renderPreviewList();
    updateCurrentFileDisplay();
  }

  function removeUploadedFile(id) {
    var idx = uploadedFiles.findIndex(function (f) {
      return f.id === id;
    });
    if (idx < 0) return;
    URL.revokeObjectURL(uploadedFiles[idx].url);
    uploadedFiles.splice(idx, 1);
    if (selectedFileId === id) {
      if (uploadedFiles.length) {
        selectUploadedFile(uploadedFiles[uploadedFiles.length - 1].id);
      } else {
        selectedFileId = null;
        currentFile = null;
        $btnGenerate.disabled = true;
        setStatus('等待上传图片…');
        updateCurrentFileDisplay();
      }
    }
    renderPreviewList();
    updateCurrentFileDisplay();
    if (uploadedFiles.length) {
      setStatus('当前选中：' + currentFile.name);
    }
    $results.classList.remove('is-visible');
  }

  function renderPreviewList() {
    if (!$previewList) return;
    $previewList.innerHTML = '';
    uploadedFiles.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'sketch-preview-card' + (item.id === selectedFileId ? ' is-active' : '');
      card.title = item.name;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      var thumb = document.createElement('div');
      thumb.className = 'sketch-preview-thumb';

      var img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sketch-preview-remove';
      btn.setAttribute('aria-label', '删除 ' + item.name);
      btn.textContent = '×';

      var label = document.createElement('span');
      label.className = 'sketch-preview-name';
      label.textContent = item.name;

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeUploadedFile(item.id);
      });

      card.addEventListener('click', function () {
        selectUploadedFile(item.id);
        setStatus('当前选中：' + item.name);
      });

      thumb.appendChild(img);
      thumb.appendChild(btn);
      card.appendChild(thumb);
      card.appendChild(label);
      $previewList.appendChild(card);
    });
  }

  function openFilePicker() {
    if ($fileInput) $fileInput.click();
  }

  function initApp() {
    $fileInput = $('sketch-file-input');
    $uploadZone = $('sketch-upload-zone');
    $btnUpload = $('sketch-btn-upload');
    $previewList = $('sketch-preview-list');
    $btnGenerate = $('sketch-btn-generate');
    $status = $('sketch-status');
    $results = $('sketch-results');
    $originalImg = $('sketch-img-original');
    $generatedImg = $('sketch-img-generated');
    $btnDownload = $('sketch-btn-download');
    $elementsBox = $('sketch-elements');
    $apiProxy = $('sketch-api-proxy');
    $siteToken = $('sketch-site-token');
    $genHint = $('sketch-gen-mode-hint');
    $currentFileBox = $('sketch-current-file');
    $currentFileName = $('sketch-current-file-name');
    $currentFileDetail = $('sketch-current-file-detail');

    if (!$fileInput) return;

    updateCurrentFileDisplay();

    restoreModelChoice();
    syncModeFromConfig();

    var modelInputs = document.querySelectorAll('input[name="sketch-model"]');
    for (var mi = 0; mi < modelInputs.length; mi += 1) {
      modelInputs[mi].addEventListener('change', persistModelChoice);
    }

    if ($btnUpload) {
      $btnUpload.addEventListener('click', function (e) {
        e.stopPropagation();
        openFilePicker();
      });
    }

    $uploadZone.addEventListener('click', function () {
      openFilePicker();
    });

    $uploadZone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    });

    $fileInput.addEventListener('change', function () {
      if ($fileInput.files && $fileInput.files.length) {
        addUploadedFiles($fileInput.files);
      }
      $fileInput.value = '';
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
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        addUploadedFiles(e.dataTransfer.files);
      }
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

  function init() {
    if (window.SketchAuth && window.SketchAuth.whenReady) {
      window.SketchAuth.whenReady().then(function () {
        initApp();
      });
      if (window.SketchAuth.onAuthChange) {
        window.SketchAuth.onAuthChange(function (loggedIn) {
          if (loggedIn && $fileInput && $btnGenerate) {
            $btnGenerate.disabled = !currentFile;
          }
        });
      }
      return;
    }
    initApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
