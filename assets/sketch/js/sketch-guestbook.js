/**
 * 生活手绘注释图 — 侧栏访客留言（词云 + 明细）
 */
(function () {
  'use strict';

  var GUEST_AVATAR_URL =
    'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

  var STOP_WORDS = {
    的: 1,
    了: 1,
    是: 1,
    在: 1,
    我: 1,
    有: 1,
    和: 1,
    就: 1,
    不: 1,
    人: 1,
    都: 1,
    一: 1,
    一个: 1,
    上: 1,
    也: 1,
    很: 1,
    到: 1,
    说: 1,
    要: 1,
    去: 1,
    你: 1,
    会: 1,
    着: 1,
    没有: 1,
    看: 1,
    好: 1,
    自己: 1,
    这: 1,
    那: 1,
    吗: 1,
    吧: 1,
    啊: 1,
    呢: 1,
    哦: 1,
    嗯: 1,
    哈: 1,
    什么: 1,
    怎么: 1,
    可以: 1,
    这个: 1,
    那个: 1,
    就是: 1,
    觉得: 1,
    一下: 1,
    真的: 1,
    还是: 1,
    我们: 1,
    你们: 1,
    他们: 1,
    不是: 1,
    可能: 1,
    已经: 1,
    非常: 1,
    比较: 1,
    感觉: 1,
    希望: 1,
    谢谢: 1,
  };

  var guestbookCache = [];
  var detailsVisible = false;

  var $cloud, $cloudEmpty, $cloudLoading, $details, $toggleDetails;
  var $modal, $input, $btnCompose, $btnSubmit, $btnCancel, $backdrop;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      ' ' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function isGuestUserName(name) {
    return /^游客\d+$/.test(String(name || ''));
  }

  function normalizeAvatarUrl(url, userName) {
    var resolved = String(url || '').trim();
    if ((isGuestUserName(userName) || !resolved) && resolved.indexOf('github.com/identicons/') !== -1) {
      return GUEST_AVATAR_URL;
    }
    if (isGuestUserName(userName) && !resolved) return GUEST_AVATAR_URL;
    return resolved;
  }

  function getClient() {
    return window.SketchAuth && window.SketchAuth.getClient ? window.SketchAuth.getClient() : null;
  }

  function getProfile() {
    if (window.SketchAuth && window.SketchAuth.getProfile) {
      return window.SketchAuth.getProfile();
    }
    return { userName: '', avatarUrl: '' };
  }

  function tokenizeContent(text) {
    var counts = {};
    var raw = String(text || '');
    var parts = raw.split(/[\s,，。！？；;、\.!\?\(\)（）\[\]【】「」"'‘’“”\/\\|｜]+/);

    function addToken(token) {
      token = token.trim();
      if (token.length < 2 || token.length > 12) return;
      if (STOP_WORDS[token]) return;
      if (/^\d+$/.test(token)) return;
      counts[token] = (counts[token] || 0) + 1;
    }

    parts.forEach(addToken);

    var cnSegments = raw.match(/[\u4e00-\u9fff]{2,8}/g) || [];
    cnSegments.forEach(function (seg) {
      if (seg.length <= 4) {
        addToken(seg);
        return;
      }
      for (var len = 2; len <= 3; len++) {
        for (var i = 0; i <= seg.length - len; i++) {
          addToken(seg.slice(i, i + len));
        }
      }
    });

    return Object.keys(counts)
      .map(function (word) {
        return { word: word, count: counts[word] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.word.length - b.word.length;
      })
      .slice(0, 28);
  }

  function extractKeywords(entries) {
    var merged = {};
    (entries || []).forEach(function (row) {
      tokenizeContent(row.content).forEach(function (item) {
        merged[item.word] = (merged[item.word] || 0) + item.count;
      });
    });
    return Object.keys(merged)
      .map(function (word) {
        return { word: word, count: merged[word] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.word.length - b.word.length;
      })
      .slice(0, 28);
  }

  function renderKeywordCloud(keywords) {
    if (!$cloud) return;
    $cloud.innerHTML = '';

    if (!keywords.length) {
      if ($cloudEmpty) {
        $cloudEmpty.textContent = guestbookCache.length
          ? '留言已收录，暂未提取到关键词'
          : '暂无留言，来做第一个留言的人吧';
        $cloudEmpty.classList.remove('is-hidden');
      }
      return;
    }
    if ($cloudEmpty) $cloudEmpty.classList.add('is-hidden');

    var maxCount = keywords[0].count;
    var total = keywords.length;

    keywords.forEach(function (item, index) {
      var rank = total > 1 ? index / (total - 1) : 0;
      var fontSize = Math.round(22 - rank * 12);
      var opacity = Math.max(0.45, 1 - rank * 0.45);
      var angle = ((index * 137.508) % 360) * (Math.PI / 180);
      var radius = rank * 38 + (index % 3) * 2;
      var x = 50 + Math.cos(angle) * radius;
      var y = 50 + Math.sin(angle) * radius;
      x = Math.max(8, Math.min(92, x));
      y = Math.max(12, Math.min(88, y));

      var span = document.createElement('span');
      span.className = 'sketch-guestbook-kw';
      span.textContent = item.word;
      span.style.left = x + '%';
      span.style.top = y + '%';
      span.style.fontSize = fontSize + 'px';
      span.style.opacity = String(opacity);
      span.style.zIndex = String(total - index);
      span.title = item.word + '（' + item.count + ' 次）';
      if (item.count === maxCount) span.classList.add('is-top');
      $cloud.appendChild(span);
    });
  }

  function renderGuestbookDetails(rows) {
    if (!$details) return;

    if (!rows.length) {
      $details.innerHTML = '<p class="sketch-guestbook-hint">暂无留言明细</p>';
      return;
    }

    $details.innerHTML = rows
      .map(function (row) {
        var name = escapeHtml(row.user_name || '用户');
        var avatar = escapeHtml(normalizeAvatarUrl(row.avatar_url, row.user_name));
        var content = escapeHtml(row.content || '');
        var avatarHtml = avatar
          ? '<img class="sketch-guestbook-detail-avatar" src="' +
            avatar +
            '" alt="' +
            name +
            '" width="32" height="32" loading="lazy">'
          : '<span class="sketch-guestbook-detail-avatar sketch-guestbook-detail-avatar--placeholder" aria-hidden="true">👤</span>';
        return (
          '<article class="sketch-guestbook-detail-item">' +
          avatarHtml +
          '<div class="sketch-guestbook-detail-body">' +
          '<div class="sketch-guestbook-detail-name">' +
          name +
          '</div>' +
          '<div class="sketch-guestbook-detail-time">' +
          formatDateTime(row.created_at) +
          '</div>' +
          '<div class="sketch-guestbook-detail-text" title="' +
          content +
          '">' +
          content +
          '</div>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function loadGuestbook() {
    var client = getClient();
    if (!client) return Promise.resolve([]);
    if ($cloudLoading) $cloudLoading.classList.remove('is-hidden');
    if ($cloudEmpty) $cloudEmpty.classList.add('is-hidden');

    return client
      .from('page_guestbook')
      .select('id, user_id, user_name, avatar_url, content, created_at')
      .order('created_at', { ascending: false })
      .then(function (result) {
        if (result.error) throw result.error;
        guestbookCache = result.data || [];
        if ($cloudLoading) $cloudLoading.classList.add('is-hidden');
        renderKeywordCloud(extractKeywords(guestbookCache));
        if (detailsVisible) renderGuestbookDetails(guestbookCache);
        return guestbookCache;
      })
      .catch(function (err) {
        console.error('loadGuestbook', err);
        if ($cloudLoading) $cloudLoading.classList.add('is-hidden');
        if ($cloudEmpty) {
          $cloudEmpty.textContent = '留言加载失败，请稍后刷新';
          $cloudEmpty.classList.remove('is-hidden');
        }
        return [];
      });
  }

  function openModal() {
    if (!window.SketchAuth || !window.SketchAuth.isLoggedIn()) {
      alert('请先登录后再留言（GitHub 或游客身份均可）');
      if (window.SketchAuth && window.SketchAuth.promptLogin) {
        window.SketchAuth.promptLogin();
      }
      return;
    }
    if ($modal) $modal.classList.remove('is-hidden');
    if ($input) {
      $input.value = '';
      $input.focus();
    }
    document.body.classList.add('sketch-guestbook-modal-open');
  }

  function closeModal() {
    if ($modal) $modal.classList.add('is-hidden');
    document.body.classList.remove('sketch-guestbook-modal-open');
  }

  function submitGuestbook() {
    var client = getClient();
    if (!client || !window.SketchAuth || !window.SketchAuth.isLoggedIn()) {
      alert('请先登录后再留言');
      return Promise.reject(new Error('Not logged in'));
    }

    var content = $input ? $input.value.trim() : '';
    if (!content) {
      alert('请输入留言内容');
      return Promise.reject(new Error('Empty'));
    }
    if (content.length > 500) {
      alert('留言不能超过 500 字');
      return Promise.reject(new Error('Too long'));
    }

    var profile = getProfile();
    var session = window.SketchAuth.getSession ? window.SketchAuth.getSession() : null;
    var rpcPromise;

    if ($btnSubmit) {
      $btnSubmit.disabled = true;
      $btnSubmit.textContent = '发布中…';
    }

    if (session && session.type === 'guest') {
      rpcPromise = client.rpc('record_guest_page_guestbook', {
        p_id: session.id,
        p_content: content,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl || GUEST_AVATAR_URL,
      });
    } else {
      rpcPromise = client.rpc('record_page_guestbook', {
        p_content: content,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl,
      });
    }

    return rpcPromise
      .then(function (result) {
        if (result.error) throw result.error;
        closeModal();
        return loadGuestbook();
      })
      .catch(function (err) {
        console.error('submitGuestbook', err);
        alert('留言失败：' + (err.message || '请稍后重试'));
      })
      .finally(function () {
        if ($btnSubmit) {
          $btnSubmit.disabled = false;
          $btnSubmit.textContent = '发布留言';
        }
      });
  }

  function toggleDetails() {
    detailsVisible = !detailsVisible;
    if ($details) $details.classList.toggle('is-hidden', !detailsVisible);
    if ($toggleDetails) {
      $toggleDetails.textContent = detailsVisible ? '隐藏留言明细' : '显示留言明细';
      $toggleDetails.setAttribute('aria-expanded', detailsVisible ? 'true' : 'false');
    }
    if (detailsVisible) renderGuestbookDetails(guestbookCache);
  }

  function bindDom() {
    $cloud = $('sketch-guestbook-cloud');
    $cloudEmpty = $('sketch-guestbook-cloud-empty');
    $cloudLoading = $('sketch-guestbook-cloud-loading');
    $details = $('sketch-guestbook-details');
    $toggleDetails = $('sketch-guestbook-toggle-details');
    $modal = $('sketch-guestbook-modal');
    $input = $('sketch-guestbook-input');
    $btnCompose = $('sketch-btn-guestbook');
    $btnSubmit = $('sketch-guestbook-submit');
    $btnCancel = $('sketch-guestbook-cancel');
    $backdrop = document.querySelector('#sketch-guestbook-modal .sketch-guestbook-modal-backdrop');

    if (!$cloud) return false;

    if ($btnCompose) $btnCompose.addEventListener('click', openModal);
    if ($btnCancel) $btnCancel.addEventListener('click', closeModal);
    if ($backdrop) $backdrop.addEventListener('click', closeModal);
    if ($btnSubmit) $btnSubmit.addEventListener('click', submitGuestbook);
    if ($toggleDetails) $toggleDetails.addEventListener('click', toggleDetails);

    if ($modal) {
      $modal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
      });
    }

    return true;
  }

  function init() {
    if (!bindDom()) return;

    function start() {
      loadGuestbook();
    }

    if (window.SketchAuth && window.SketchAuth.whenReady) {
      window.SketchAuth.whenReady().then(start);
      if (window.SketchAuth.onAuthChange) {
        window.SketchAuth.onAuthChange(function () {
          /* 登录状态变化不影响已加载留言 */
        });
      }
    } else {
      start();
    }
  }

  window.SketchGuestbook = {
    refresh: loadGuestbook,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
