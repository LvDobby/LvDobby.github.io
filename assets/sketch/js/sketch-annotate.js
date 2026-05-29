/**
 * 生活手绘注释图 — 云端生成客户端
 */
(function () {
  'use strict';

  var SKETCH_BUILD = window.SKETCH_BUILD || {};
  var SKETCH_PROMPT = SKETCH_BUILD.clientPromptShort || '小红书随手记录风格手绘注释';
  var MODEL_LABELS = SKETCH_BUILD.modelLabels || {};
  var DEFAULT_MODEL = SKETCH_BUILD.defaultModel || 'bytedance-seed/seedream-4.5';

  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var MAX_SIDE = 1400;

  var $fileInput, $uploadZone, $previewList, $btnGenerate, $status, $results, $originalImg, $generatedImg;
  var $btnDownload, $elementsBox, $apiProxy, $siteToken, $genHint;
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

  function getSelectedModelId() {
    var checked = document.querySelector('input[name="sketch-model"]:checked');
    return checked ? checked.value : DEFAULT_MODEL;
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

    var auth = window.SketchAuth;
    var startGenerate = function () {
      $btnGenerate.disabled = true;
      setStatus('正在使用 ' + getSelectedModelLabel() + ' 生成手绘注释图…', true);

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
          if (auth && auth.consumeDrawQuotaOnSuccess) {
            auth.consumeDrawQuotaOnSuccess();
          }
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
            setStatus('生成失败：' + msg + '（未扣减额度，请重试）');
          }
        })
        .finally(function () {
          $btnGenerate.disabled = false;
        });
    };

    if (auth && auth.ensureQuotaLoaded) {
      auth.ensureQuotaLoaded().then(function (quota) {
        if (quota <= 0) {
          if (auth.showQuotaExhaustedModal) auth.showQuotaExhaustedModal();
          return;
        }
        startGenerate();
      });
      return;
    }

    startGenerate();
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
    $results.classList.remove('is-visible');
    return true;
  }

  function addUploadedFiles(fileList) {
    var added = 0;
    for (var i = 0; i < fileList.length; i += 1) {
      if (addUploadedFile(fileList[i])) added += 1;
    }
    if (added > 0) {
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
      }
    }
    renderPreviewList();
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

    if (!$fileInput || !$uploadZone) return;

    restoreModelChoice();
    syncModeFromConfig();

    var modelInputs = document.querySelectorAll('input[name="sketch-model"]');
    for (var mi = 0; mi < modelInputs.length; mi += 1) {
      modelInputs[mi].addEventListener('change', persistModelChoice);
    }

    if ($uploadZone) {
      $uploadZone.addEventListener('click', function () {
        openFilePicker();
      });

      $uploadZone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFilePicker();
        }
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
    }

    $fileInput.addEventListener('change', function () {
      if ($fileInput.files && $fileInput.files.length) {
        addUploadedFiles($fileInput.files);
      }
      $fileInput.value = '';
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
