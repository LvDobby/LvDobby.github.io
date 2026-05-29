-- 修复旧游客 identicon 头像（中文用户名会导致 404）

UPDATE public.user_stats
SET avatar_url = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
WHERE is_guest = true
  AND (
    avatar_url IS NULL
    OR avatar_url = ''
    OR avatar_url LIKE '%github.com/identicons/%'
  );

UPDATE public.page_reactions
SET avatar_url = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
WHERE user_name ~ '^游客[0-9]+$'
  AND avatar_url LIKE '%github.com/identicons/%';
