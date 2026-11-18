// External publishing/sending connectors. Every call site checks approval first; these only perform the action.
// Without credentials each connector reports `available: false` and the app keeps the manual export path.

export const publishers = {
  linkedin: {
    status: () => process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN
      ? { available: true, note: 'Text posts via LinkedIn Posts API. Image posts: use manual export.' }
      : { available: false, note: 'Set LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN (w_member_social scope) to enable direct posting.' },
    async publish({ text, hasImage }) {
      if (hasImage) throw Object.assign(new Error('Direct image upload to LinkedIn is not implemented yet. Remove the image or use manual export.'), { status: 400 });
      const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'LinkedIn-Version': process.env.LINKEDIN_VERSION || '202510', 'X-Restli-Protocol-Version': '2.0.0' },
        body: JSON.stringify({ author: process.env.LINKEDIN_AUTHOR_URN, commentary: text, visibility: 'PUBLIC', lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] } })
      });
      if (!res.ok) throw Object.assign(new Error(`LinkedIn API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: 502 });
      return { ref: res.headers.get('x-restli-id') || 'posted' };
    }
  },
  instagram: {
    status: () => ({ available: false, note: 'Instagram Graph API publishing is pending (needs a Business account, app review, and a public media URL). Use manual export.' })
  },
  email: {
    status: () => ({ available: false, note: 'Email sending integration is pending. Copy the approved draft into your mail client, then mark it sent.' })
  }
};
