/**
 * 生活手绘注释图 — GitHub OAuth 登录 + 纯数据库游客会话
 */
(function () {
  'use strict';

  var GUEST_STORAGE_KEY = 'sketch_guest_session';
  var GUEST_AVATAR_URL =
    'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
  var HIDE_VISIT_STORAGE_PREFIX = 'sketch_hide_visit_';

  var supabase = null;
  /** @type {{ type: 'github', user: object } | { type: 'guest', id: string, userName: string, avatarUrl: string } | null} */
  var currentSession = null;
  var currentProfile = null;
  var readyCallbacks = [];
  var authChangeCallbacks = [];
  var authReady = false;
  var statsCache = [];
  var reactionsCache = [];
  var currentQuota = null;
  var quotaThanksTimer = null;

  var $loginModal, $app, $userBar, $userAvatar, $userName, $btnLogout;
  var $btnGithubLogin, $btnGuestLogin;
  var $statsList, $statsEmpty, $statsLoading;
  var $btnLike, $btnDislike, $likeCount, $dislikeCount;
  var $reactionsList, $reactionsEmpty, $reactionsLoading;
  var $quotaBadge, $quotaHint, $quotaHintCount;
  var $quotaModal, $quotaStateLimit, $quotaStatePay, $quotaStateThanks, $quotaPayBtn, $quotaPaidBtn, $quotaBackdrop;

  function $(id) {
    return document.getElementById(id);
  }

  function getConfig() {
    return window.SKETCH_CONFIG || {};
  }

  function isConfigured() {
    var cfg = getConfig();
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function isLoggedIn() {
    return !!currentSession;
  }

  function getCurrentUser() {
    if (!currentSession) return null;
    if (currentSession.type === 'github') return currentSession.user;
    return { id: currentSession.id, isGuest: true };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isGuestUserName(name) {
    return /^游客\d+$/.test(String(name || ''));
  }

  function normalizeAvatarUrl(url, options) {
    var opts = options || {};
    var isGuest = !!opts.isGuest || isGuestUserName(opts.userName);
    var resolved = String(url || '').trim();
    if (isGuest && (!resolved || resolved.indexOf('github.com/identicons/') !== -1)) {
      return GUEST_AVATAR_URL;
    }
    return resolved;
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

  function profileFromGitHubUser(user) {
    var meta = (user && user.user_metadata) || {};
    return {
      userName:
        meta.user_name ||
        meta.preferred_username ||
        meta.full_name ||
        meta.name ||
        (user && user.email) ||
        'GitHub User',
      avatarUrl: meta.avatar_url || meta.picture || '',
    };
  }

  function notifyReady() {
    authReady = true;
    var loggedIn = isLoggedIn();
    readyCallbacks.splice(0).forEach(function (cb) {
      try {
        cb(loggedIn);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function notifyAuthChange(loggedIn) {
    authChangeCallbacks.forEach(function (cb) {
      try {
        cb(loggedIn);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function whenReady() {
    return new Promise(function (resolve) {
      if (authReady) {
        resolve(isLoggedIn());
        return;
      }
      readyCallbacks.push(resolve);
    });
  }

  function onAuthChange(cb) {
    authChangeCallbacks.push(cb);
  }

  function showLoginModal() {
    if ($loginModal) {
      $loginModal.classList.add('is-open');
      document.body.classList.add('sketch-modal-open');
    }
    resetGuestLoginButton();
    if ($btnGithubLogin) $btnGithubLogin.disabled = false;
  }

  function hideLoginModal() {
    if ($loginModal) $loginModal.classList.remove('is-open');
    document.body.classList.remove('sketch-modal-open');
  }

  function setView(loggedIn) {
    if ($app) $app.classList.remove('is-hidden');
    if ($userBar) $userBar.classList.toggle('is-hidden', !loggedIn);
    if (loggedIn) {
      hideLoginModal();
    } else {
      showLoginModal();
    }
  }

  function renderUserBarFromProfile(profile) {
    if (!profile || !$userBar) return;
    currentProfile = profile;
    var avatarUrl = normalizeAvatarUrl(profile.avatarUrl, {
      isGuest: currentSession && currentSession.type === 'guest',
      userName: profile.userName,
    });
    if ($userAvatar) {
      $userAvatar.src = avatarUrl;
      $userAvatar.alt = profile.userName;
      $userAvatar.classList.toggle('is-placeholder', !avatarUrl);
    }
    if ($userName) $userName.textContent = profile.userName;
  }

  function saveGuestSession(row) {
    try {
      localStorage.setItem(
        GUEST_STORAGE_KEY,
        JSON.stringify({
          id: row.id,
          userName: row.user_name,
          avatarUrl: normalizeAvatarUrl(row.avatar_url, {
            isGuest: true,
            userName: row.user_name,
          }),
          isGuest: true,
        }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  function clearGuestSession() {
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function readGuestSession() {
    try {
      var raw = localStorage.getItem(GUEST_STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.id || !data.isGuest) return null;
      data.avatarUrl = normalizeAvatarUrl(data.avatarUrl, {
        isGuest: true,
        userName: data.userName,
      });
      return data;
    } catch (e) {
      return null;
    }
  }

  function activateGuestSession(data) {
    currentSession = {
      type: 'guest',
      id: data.id,
      userName: data.userName,
      avatarUrl: data.avatarUrl,
    };
    renderUserBarFromProfile({
      userName: data.userName,
      avatarUrl: data.avatarUrl,
    });
    setView(true);
    loadUserQuota();
  }

  function restoreGuestSession() {
    var data = readGuestSession();
    if (!data) return false;
    activateGuestSession(data);
    notifyAuthChange(true);
    return true;
  }

  function sortStats(rows) {
    return rows.slice().sort(function (a, b) {
      var diff = (b.login_count || 0) - (a.login_count || 0);
      if (diff !== 0) return diff;
      return new Date(b.last_login || 0) - new Date(a.last_login || 0);
    });
  }

  function renderStatsList(rows) {
    statsCache = sortStats(rows || []);
    if (!$statsList) return;

    if ($statsLoading) $statsLoading.classList.add('is-hidden');
    if (!statsCache.length) {
      $statsList.innerHTML = '';
      if ($statsEmpty) $statsEmpty.classList.remove('is-hidden');
      return;
    }
    if ($statsEmpty) $statsEmpty.classList.add('is-hidden');

    $statsList.innerHTML = statsCache
      .map(function (row) {
        var name = escapeHtml(row.user_name || '用户');
        var avatar = escapeHtml(
          normalizeAvatarUrl(row.avatar_url, { isGuest: row.is_guest, userName: row.user_name }),
        );
        var avatarHtml = avatar
          ? '<img class="sketch-stats-avatar" src="' +
            avatar +
            '" alt="' +
            name +
            '" width="40" height="40" loading="lazy">'
          : '<span class="sketch-stats-avatar sketch-stats-avatar--placeholder" aria-hidden="true">👤</span>';
        return (
          '<article class="sketch-stats-card">' +
          avatarHtml +
          '<div class="sketch-stats-body">' +
          '<div class="sketch-stats-name">' +
          name +
          '</div>' +
          '<div class="sketch-stats-meta">' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">最近登录</span>' +
          formatDateTime(row.last_login) +
          '</span>' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">访问</span>' +
          String(row.login_count || 0) +
          '</span>' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">生成</span>' +
          String(row.draw_count || 0) +
          '</span>' +
          buildHideVisitControl(row) +
          '</div>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function loadUserStats() {
    if (!supabase) return Promise.resolve([]);
    if ($statsLoading) $statsLoading.classList.remove('is-hidden');
    if ($statsEmpty) $statsEmpty.classList.add('is-hidden');

    return supabase
      .from('user_stats')
      .select('id, user_name, avatar_url, first_login, last_login, login_count, draw_count, is_guest')
      .then(function (result) {
        if (result.error) throw result.error;
        renderStatsList(result.data || []);
        return result.data || [];
      })
      .catch(function (err) {
        console.error('loadUserStats', err);
        if ($statsLoading) $statsLoading.classList.add('is-hidden');
        if ($statsEmpty) {
          $statsEmpty.textContent = '统计数据加载失败，请稍后刷新';
          $statsEmpty.classList.remove('is-hidden');
        }
        return [];
      });
  }

  function recordGitHubLogin(user) {
    var profile = profileFromGitHubUser(user);
    return supabase
      .rpc('record_user_login', {
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl,
      })
      .then(function (result) {
        if (result.error) throw result.error;
        return loadUserStats().then(function () {
          return loadUserQuota().then(function () {
            return profile;
          });
        });
      });
  }

  function resetGuestLoginButton() {
    if (!$btnGuestLogin) return;
    $btnGuestLogin.disabled = false;
    $btnGuestLogin.innerHTML = '<span aria-hidden="true">👤</span> 游客身份进入';
  }

  function registerGuestLogin() {
    if (!supabase) return Promise.reject(new Error('Supabase not configured'));
    return supabase.rpc('register_guest_user').then(function (result) {
      if (result.error) throw result.error;
      var row = result.data || {};
      if (!row.id) throw new Error('游客记录创建失败');
      saveGuestSession(row);
      clearVisitHiddenFlag(row.id);
      activateGuestSession({
        id: row.id,
        userName: row.user_name,
        avatarUrl: row.avatar_url || GUEST_AVATAR_URL,
      });
      return loadUserStats().then(function () {
        return loadUserQuota().then(function () {
          return row;
        });
      });
    });
  }

  function getSessionUserId() {
    if (!currentSession) return null;
    if (currentSession.type === 'guest') return currentSession.id;
    return currentSession.user && currentSession.user.id;
  }

  function getSessionInfo() {
    if (!currentSession) return null;
    if (currentSession.type === 'guest') {
      return { type: 'guest', id: currentSession.id };
    }
    return { type: 'github', id: currentSession.user && currentSession.user.id };
  }

  function promptLogin() {
    showLoginModal();
  }

  function hideVisitStorageKey(userId) {
    return HIDE_VISIT_STORAGE_PREFIX + userId;
  }

  function isVisitHiddenThisPage(userId) {
    if (!userId) return false;
    try {
      return sessionStorage.getItem(hideVisitStorageKey(userId)) === '1';
    } catch (e) {
      return false;
    }
  }

  function markVisitHiddenThisPage(userId) {
    if (!userId) return;
    try {
      sessionStorage.setItem(hideVisitStorageKey(userId), '1');
    } catch (e) {
      /* ignore */
    }
  }

  function clearVisitHiddenFlag(userId) {
    if (!userId) return;
    try {
      sessionStorage.removeItem(hideVisitStorageKey(userId));
    } catch (e) {
      /* ignore */
    }
  }

  function buildHideVisitControl(row) {
    var uid = getSessionUserId();
    if (!uid || row.id !== uid) return '';

    if (isVisitHiddenThisPage(uid)) {
      return (
        '<span class="sketch-stats-meta-item sketch-stats-meta-item--action">' +
        '<span class="sketch-stats-hidden-label">此次访问已隐藏</span>' +
        '</span>'
      );
    }

    return (
      '<span class="sketch-stats-meta-item sketch-stats-meta-item--action">' +
      '<button type="button" class="sketch-stats-hide-btn" data-user-id="' +
      escapeHtml(row.id) +
      '">隐藏此次访问</button>' +
      '</span>'
    );
  }

  function hideCurrentVisit(userId) {
    if (!supabase || !currentSession || userId !== getSessionUserId()) {
      return Promise.reject(new Error('无法隐藏此次访问'));
    }
    if (isVisitHiddenThisPage(userId)) {
      return Promise.resolve();
    }

    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('hide_guest_login', { p_id: userId });
    } else {
      rpcPromise = supabase.rpc('hide_current_login');
    }

    return rpcPromise.then(function (result) {
      if (result.error) throw result.error;
      markVisitHiddenThisPage(userId);
      var idx = statsCache.findIndex(function (row) {
        return row.id === userId;
      });
      if (idx >= 0) {
        statsCache[idx].login_count = Math.max(0, (statsCache[idx].login_count || 0) - 1);
        renderStatsList(statsCache);
      }
      return loadUserStats();
    });
  }

  function onStatsListClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.sketch-stats-hide-btn') : null;
    if (!btn || btn.disabled) return;
    var userId = btn.getAttribute('data-user-id');
    if (!userId || userId !== getSessionUserId()) return;

    btn.disabled = true;
    btn.textContent = '处理中…';

    hideCurrentVisit(userId).catch(function (err) {
      console.error('hideCurrentVisit', err);
      btn.disabled = false;
      btn.textContent = '隐藏此次访问';
      alert('隐藏失败：' + (err.message || '请稍后重试'));
    });
  }

  function getCurrentProfile() {
    if (currentProfile) {
      return {
        userName: currentProfile.userName,
        avatarUrl: normalizeAvatarUrl(currentProfile.avatarUrl, {
          isGuest: currentSession && currentSession.type === 'guest',
          userName: currentProfile.userName,
        }),
      };
    }
    if (currentSession && currentSession.type === 'guest') {
      return {
        userName: currentSession.userName,
        avatarUrl: normalizeAvatarUrl(currentSession.avatarUrl, {
          isGuest: true,
          userName: currentSession.userName,
        }),
      };
    }
    if (currentSession && currentSession.type === 'github') {
      return profileFromGitHubUser(currentSession.user);
    }
    return { userName: '', avatarUrl: '' };
  }

  function updateReactionTotals(rows) {
    var likeCount = 0;
    var dislikeCount = 0;
    (rows || []).forEach(function (row) {
      if (row.reaction_type === 'like') likeCount += 1;
      else if (row.reaction_type === 'dislike') dislikeCount += 1;
    });
    if ($likeCount) $likeCount.textContent = String(likeCount);
    if ($dislikeCount) $dislikeCount.textContent = String(dislikeCount);
  }

  function renderReactionsList(rows) {
    reactionsCache = rows || [];
    updateReactionTotals(reactionsCache);

    if (!$reactionsList) return;
    if ($reactionsLoading) $reactionsLoading.classList.add('is-hidden');

    if (!reactionsCache.length) {
      $reactionsList.innerHTML = '';
      if ($reactionsEmpty) $reactionsEmpty.classList.remove('is-hidden');
      return;
    }
    if ($reactionsEmpty) $reactionsEmpty.classList.add('is-hidden');

    $reactionsList.innerHTML = reactionsCache
      .map(function (row) {
        var name = escapeHtml(row.user_name || '用户');
        var avatar = escapeHtml(normalizeAvatarUrl(row.avatar_url, { userName: row.user_name }));
        var isLike = row.reaction_type === 'like';
        var avatarHtml = avatar
          ? '<img class="sketch-reaction-item-avatar" src="' +
            avatar +
            '" alt="' +
            name +
            '" width="36" height="36" loading="lazy">'
          : '<span class="sketch-reaction-item-avatar sketch-reaction-item-avatar--placeholder" aria-hidden="true">👤</span>';
        return (
          '<article class="sketch-reaction-item">' +
          avatarHtml +
          '<div class="sketch-reaction-item-body">' +
          '<div class="sketch-reaction-item-name">' +
          name +
          '</div>' +
          '<div class="sketch-reaction-item-time">' +
          formatDateTime(row.created_at) +
          '</div>' +
          '</div>' +
          '<span class="sketch-reaction-badge sketch-reaction-badge--' +
          (isLike ? 'like' : 'dislike') +
          '">' +
          (isLike ? '赞' : '踩') +
          '</span>' +
          '</article>'
        );
      })
      .join('');
  }

  function loadPageReactions() {
    if (!supabase) return Promise.resolve([]);
    if ($reactionsLoading) $reactionsLoading.classList.remove('is-hidden');
    if ($reactionsEmpty) $reactionsEmpty.classList.add('is-hidden');

    return supabase
      .from('page_reactions')
      .select('id, user_id, user_name, avatar_url, reaction_type, created_at')
      .order('created_at', { ascending: false })
      .then(function (result) {
        if (result.error) throw result.error;
        renderReactionsList(result.data || []);
        return result.data || [];
      })
      .catch(function (err) {
        console.error('loadPageReactions', err);
        if ($reactionsLoading) $reactionsLoading.classList.add('is-hidden');
        if ($reactionsEmpty) {
          $reactionsEmpty.textContent = '反馈记录加载失败，请稍后刷新';
          $reactionsEmpty.classList.remove('is-hidden');
        }
        return [];
      });
  }

  function recordPageReaction(reactionType) {
    if (!supabase || !currentSession) {
      return Promise.reject(new Error('请先登录后再点赞或点踩'));
    }
    if (reactionType !== 'like' && reactionType !== 'dislike') {
      return Promise.reject(new Error('无效操作'));
    }

    var profile = getCurrentProfile();
    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('record_guest_page_reaction', {
        p_id: currentSession.id,
        p_reaction: reactionType,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl || GUEST_AVATAR_URL,
      });
    } else {
      rpcPromise = supabase.rpc('record_page_reaction', {
        p_reaction: reactionType,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl,
      });
    }

    return rpcPromise.then(function (result) {
      if (result.error) throw result.error;
      return loadPageReactions();
    });
  }

  function onReactionClick(reactionType) {
    if (!isLoggedIn()) {
      alert('请先登录后再点赞或点踩');
      showLoginModal();
      return;
    }

    var btn = reactionType === 'like' ? $btnLike : $btnDislike;
    if (btn) btn.disabled = true;

    recordPageReaction(reactionType)
      .catch(function (err) {
        console.error('recordPageReaction', err);
        alert('提交失败：' + (err.message || '请稍后重试'));
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function renderQuotaUI() {
    var show = isLoggedIn() && currentQuota !== null;
    if ($quotaBadge) {
      $quotaBadge.classList.toggle('is-hidden', !show);
      if (show) $quotaBadge.textContent = '剩余 ' + currentQuota + ' 次';
    }
    if ($quotaHint) {
      $quotaHint.classList.toggle('is-hidden', !show);
    }
    if ($quotaHintCount && show) {
      $quotaHintCount.textContent = String(currentQuota);
    }
  }

  function loadUserQuota() {
    if (!supabase || !currentSession) {
      currentQuota = null;
      renderQuotaUI();
      return Promise.resolve(0);
    }
    var uid = getSessionUserId();
    return supabase
      .from('user_stats')
      .select('remaining_draw_quota')
      .eq('id', uid)
      .single()
      .then(function (result) {
        if (result.error) throw result.error;
        currentQuota =
          typeof result.data.remaining_draw_quota === 'number'
            ? result.data.remaining_draw_quota
            : 1;
        renderQuotaUI();
        return currentQuota;
      })
      .catch(function (err) {
        console.error('loadUserQuota', err);
        currentQuota = 0;
        renderQuotaUI();
        return currentQuota;
      });
  }

  function ensureQuotaLoaded() {
    if (!isLoggedIn()) return Promise.resolve(0);
    return loadUserQuota();
  }

  function getRemainingQuota() {
    return currentQuota !== null ? currentQuota : 0;
  }

  function resetQuotaModal() {
    if (quotaThanksTimer) {
      clearTimeout(quotaThanksTimer);
      quotaThanksTimer = null;
    }
    if ($quotaStateLimit) $quotaStateLimit.classList.remove('is-hidden');
    if ($quotaStatePay) $quotaStatePay.classList.add('is-hidden');
    if ($quotaStateThanks) $quotaStateThanks.classList.add('is-hidden');
    if ($quotaPayBtn) $quotaPayBtn.disabled = false;
    if ($quotaPaidBtn) {
      $quotaPaidBtn.disabled = false;
      $quotaPaidBtn.textContent = '我已完成扫码付款';
    }
  }

  function showQuotaPayState() {
    if ($quotaStateLimit) $quotaStateLimit.classList.add('is-hidden');
    if ($quotaStatePay) $quotaStatePay.classList.remove('is-hidden');
    if ($quotaStateThanks) $quotaStateThanks.classList.add('is-hidden');
  }

  function showQuotaThanksState() {
    if ($quotaStateLimit) $quotaStateLimit.classList.add('is-hidden');
    if ($quotaStatePay) $quotaStatePay.classList.add('is-hidden');
    if ($quotaStateThanks) $quotaStateThanks.classList.remove('is-hidden');
  }

  function showQuotaExhaustedModal() {
    if (!$quotaModal) return;
    resetQuotaModal();
    $quotaModal.classList.remove('is-hidden');
    document.body.classList.add('sketch-modal-open');
  }

  function hideQuotaModal() {
    if (!$quotaModal) return;
    $quotaModal.classList.add('is-hidden');
    document.body.classList.remove('sketch-modal-open');
    resetQuotaModal();
  }

  function onQuotaBackdropClick() {
    if ($quotaStateThanks && !$quotaStateThanks.classList.contains('is-hidden')) {
      return;
    }
    if ($quotaStatePay && !$quotaStatePay.classList.contains('is-hidden')) {
      resetQuotaModal();
      return;
    }
    hideQuotaModal();
  }

  function onQuotaPayClick() {
    showQuotaPayState();
  }

  function onQuotaPaidConfirmClick() {
    if ($quotaPaidBtn) {
      $quotaPaidBtn.disabled = true;
      $quotaPaidBtn.textContent = '确认中…';
    }
    grantBonusDrawQuota()
      .then(function () {
        showQuotaThanksState();
        quotaThanksTimer = setTimeout(function () {
          hideQuotaModal();
        }, 3000);
      })
      .catch(function (err) {
        console.error('grantBonusDrawQuota', err);
        if ($quotaPaidBtn) {
          $quotaPaidBtn.disabled = false;
          $quotaPaidBtn.textContent = '我已完成扫码付款';
        }
        alert('额度增加失败：' + (err.message || '请稍后重试'));
      });
  }
  function grantBonusDrawQuota() {
    if (!supabase || !currentSession) {
      return Promise.reject(new Error('请先登录'));
    }
    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('grant_guest_bonus_draw_quota', { p_id: currentSession.id });
    } else {
      rpcPromise = supabase.rpc('grant_bonus_draw_quota');
    }
    return rpcPromise.then(function (result) {
      if (result.error) throw result.error;
      var data = result.data || {};
      if (typeof data.remaining_draw_quota === 'number') {
        currentQuota = data.remaining_draw_quota;
      } else {
        currentQuota = (currentQuota || 0) + 1;
      }
      renderQuotaUI();
      return currentQuota;
    });
  }

  function consumeDrawQuotaOnSuccess() {
    if (!supabase || !currentSession) return Promise.resolve();
    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('consume_guest_draw_quota', { p_id: currentSession.id });
    } else {
      rpcPromise = supabase.rpc('consume_draw_quota');
    }
    return rpcPromise
      .then(function (result) {
        if (result.error) throw result.error;
        var data = result.data || {};
        if (typeof data.remaining_draw_quota === 'number') {
          currentQuota = data.remaining_draw_quota;
        } else if (currentQuota !== null) {
          currentQuota = Math.max(0, currentQuota - 1);
        }
        renderQuotaUI();
        var uid = getSessionUserId();
        var idx = statsCache.findIndex(function (row) {
          return row.id === uid;
        });
        if (idx >= 0) {
          statsCache[idx].draw_count = (statsCache[idx].draw_count || 0) + 1;
          renderStatsList(statsCache);
        }
      })
      .catch(function (err) {
        console.error('consumeDrawQuotaOnSuccess', err);
      });
  }

  function incrementDrawCount() {
    if (!supabase || !currentSession) return Promise.resolve();
    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('increment_guest_draw_count', { p_id: currentSession.id });
    } else {
      rpcPromise = supabase.rpc('increment_draw_count');
    }
    return rpcPromise
      .then(function (result) {
        if (result.error) throw result.error;
        var uid = getSessionUserId();
        var idx = statsCache.findIndex(function (row) {
          return row.id === uid;
        });
        if (idx >= 0) {
          statsCache[idx].draw_count = (statsCache[idx].draw_count || 0) + 1;
          renderStatsList(statsCache);
        }
        return loadUserStats();
      })
      .catch(function (err) {
        console.error('incrementDrawCount', err);
      });
  }

  function handleGitHubSession(session, eventType) {
    var user = session && session.user;
    if (!user) {
      if (restoreGuestSession()) {
        notifyReady();
        return Promise.resolve();
      }
      currentSession = null;
      currentProfile = null;
      setView(false);
      notifyAuthChange(false);
      notifyReady();
      return Promise.resolve();
    }

    clearGuestSession();
    currentSession = { type: 'github', user: user };
    setView(true);

    if (eventType === 'SIGNED_IN') {
      return recordGitHubLogin(user)
        .then(function (profile) {
          clearVisitHiddenFlag(user.id);
          renderUserBarFromProfile(profile);
          notifyAuthChange(true);
          return loadUserQuota();
        })
        .catch(function (err) {
          console.error('recordGitHubLogin', err);
          renderUserBarFromProfile(profileFromGitHubUser(user));
        })
        .finally(notifyReady);
    }

    return Promise.resolve()
      .then(function () {
        renderUserBarFromProfile(profileFromGitHubUser(user));
        notifyAuthChange(true);
        return loadUserQuota();
      })
      .finally(notifyReady);
  }

  function signInWithGitHub() {
    if (!supabase) {
      alert('未配置 Supabase，请在 _config.yml 中填写 supabase_url 与 supabase_anon_key');
      return Promise.reject(new Error('Supabase not configured'));
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;
    if ($btnGuestLogin) $btnGuestLogin.disabled = true;
    var redirectTo = window.location.origin + window.location.pathname;
    return supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: redirectTo },
    });
  }

  function signInAsGuest() {
    if (!supabase) {
      alert('未配置 Supabase，请在 _config.yml 中填写 supabase_url 与 supabase_anon_key');
      return Promise.reject(new Error('Supabase not configured'));
    }
    if ($btnGuestLogin) {
      $btnGuestLogin.disabled = true;
      $btnGuestLogin.textContent = '正在进入…';
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;

    return registerGuestLogin()
      .then(function () {
        notifyAuthChange(true);
      })
      .catch(function (err) {
        resetGuestLoginButton();
        if ($btnGithubLogin) $btnGithubLogin.disabled = false;
        alert('游客进入失败：' + (err.message || '请稍后重试'));
        throw err;
      })
      .finally(function () {
        resetGuestLoginButton();
        if ($btnGithubLogin) $btnGithubLogin.disabled = false;
        notifyReady();
      });
  }

  function signOut() {
    var done = function () {
      currentSession = null;
      currentProfile = null;
      currentQuota = null;
      renderQuotaUI();
      clearGuestSession();
      setView(false);
      notifyAuthChange(false);
    };

    if (currentSession && currentSession.type === 'guest') {
      done();
      return Promise.resolve();
    }

    if (!supabase) {
      done();
      return Promise.resolve();
    }

    return supabase.auth.signOut().then(done).catch(function () {
      done();
    });
  }

  function showConfigWarning() {
    showLoginModal();
    var msg = document.querySelector('#sketch-login-modal .sketch-login-note');
    if (msg) {
      msg.textContent =
        '站点尚未配置 Supabase（supabase_url / supabase_anon_key），请在 _config.yml 中填写后重新部署。';
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;
    if ($btnGuestLogin) $btnGuestLogin.disabled = true;
    notifyReady();
  }

  function bindDom() {
    $loginModal = $('sketch-login-modal');
    $app = $('sketch-app');
    if ($app) $app.classList.remove('is-hidden');
    $userBar = $('sketch-user-bar');
    $userAvatar = $('sketch-user-avatar');
    $userName = $('sketch-user-name');
    $btnLogout = $('sketch-btn-logout');
    $btnGithubLogin = $('sketch-btn-github-login');
    $btnGuestLogin = $('sketch-btn-guest-login');
    $statsList = $('sketch-stats-list');
    $statsEmpty = $('sketch-stats-empty');
    $statsLoading = $('sketch-stats-loading');
    $btnLike = $('sketch-btn-like');
    $btnDislike = $('sketch-btn-dislike');
    $likeCount = $('sketch-like-count');
    $dislikeCount = $('sketch-dislike-count');
    $reactionsList = $('sketch-reactions-list');
    $reactionsEmpty = $('sketch-reactions-empty');
    $reactionsLoading = $('sketch-reactions-loading');
    $quotaBadge = $('sketch-quota-badge');
    $quotaHint = $('sketch-quota-hint');
    $quotaHintCount = $('sketch-quota-hint-count');
    $quotaModal = $('sketch-quota-modal');
    $quotaStateLimit = $('sketch-quota-state-limit');
    $quotaStatePay = $('sketch-quota-state-pay');
    $quotaStateThanks = $('sketch-quota-state-thanks');
    $quotaPayBtn = $('sketch-quota-pay-btn');
    $quotaPaidBtn = $('sketch-quota-paid-btn');
    $quotaBackdrop = $quotaModal ? $quotaModal.querySelector('.sketch-quota-backdrop') : null;

    if ($quotaPayBtn) {
      $quotaPayBtn.addEventListener('click', onQuotaPayClick);
    }
    if ($quotaPaidBtn) {
      $quotaPaidBtn.addEventListener('click', onQuotaPaidConfirmClick);
    }
    if ($quotaBackdrop) {
      $quotaBackdrop.addEventListener('click', onQuotaBackdropClick);
    }

    var loginBackdrop = $loginModal ? $loginModal.querySelector('.sketch-login-backdrop') : null;
    if (loginBackdrop) {
      loginBackdrop.addEventListener('click', hideLoginModal);
    }

    if ($btnGithubLogin) {
      $btnGithubLogin.addEventListener('click', signInWithGitHub);
    }
    if ($btnGuestLogin) {
      $btnGuestLogin.addEventListener('click', signInAsGuest);
    }
    if ($btnLogout) {
      $btnLogout.addEventListener('click', signOut);
    }
    if ($statsList) {
      $statsList.addEventListener('click', onStatsListClick);
    }
    if ($btnLike) {
      $btnLike.addEventListener('click', function () {
        onReactionClick('like');
      });
    }
    if ($btnDislike) {
      $btnDislike.addEventListener('click', function () {
        onReactionClick('dislike');
      });
    }
  }

  function initSupabase() {
    bindDom();

    if (!isConfigured()) {
      showConfigWarning();
      return;
    }

    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.error('Supabase SDK not loaded');
      showConfigWarning();
      return;
    }

    var cfg = getConfig();
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    loadUserStats();
    loadPageReactions();

    supabase.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') {
        if (restoreGuestSession()) {
          notifyReady();
          return;
        }
      }
      handleGitHubSession(session, event);
    });

    supabase.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session && session.user) {
        handleGitHubSession(session, 'INITIAL_SESSION');
        return;
      }
      if (restoreGuestSession()) {
        notifyReady();
        return;
      }
      handleGitHubSession(null, 'SIGNED_OUT');
    });
  }

  window.SketchAuth = {
    whenReady: whenReady,
    onAuthChange: onAuthChange,
    isLoggedIn: isLoggedIn,
    getCurrentUser: getCurrentUser,
    getClient: function () {
      return supabase;
    },
    getProfile: getCurrentProfile,
    getSession: getSessionInfo,
    promptLogin: promptLogin,
    signInWithGitHub: signInWithGitHub,
    signInAsGuest: signInAsGuest,
    signOut: signOut,
    incrementDrawCount: incrementDrawCount,
    getRemainingQuota: getRemainingQuota,
    ensureQuotaLoaded: ensureQuotaLoaded,
    loadUserQuota: loadUserQuota,
    consumeDrawQuotaOnSuccess: consumeDrawQuotaOnSuccess,
    grantBonusDrawQuota: grantBonusDrawQuota,
    showQuotaExhaustedModal: showQuotaExhaustedModal,
    hideQuotaModal: hideQuotaModal,
    refreshStats: loadUserStats,
    refreshReactions: loadPageReactions,
    recordPageReaction: recordPageReaction,
    isConfigured: isConfigured,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
  } else {
    initSupabase();
  }
})();
