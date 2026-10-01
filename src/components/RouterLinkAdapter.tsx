import { forwardRef } from 'react';
import { Link } from 'react-router';

/** Lets Astryx Button/Link/ListItem `href` navigate inside the SPA. External and tel: URLs stay plain links. */
export const RouterLinkAdapter = forwardRef<HTMLAnchorElement, { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>(
  function RouterLinkAdapter({ href, ...rest }, ref) {
    return <Link ref={ref} to={href} {...rest} />;
  },
);
