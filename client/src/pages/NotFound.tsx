import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { GiantWordmark } from '../components/layout';
import { SectionHeading } from '../components/ui';

export default function NotFound() {
  return (
    <div className="pt-40">
      <div className="mx-auto max-w-4xl px-6 pb-24 sm:px-10">
        <SectionHeading
          eyebrow="404"
          title="This path does not lead anywhere"
          accent="in ECHOES."
          description="The page you asked for is not part of the platform. The map, the assistant and the experiences list all still work."
        />
        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/discover" className="btn-primary">
            <Compass className="h-4 w-4" aria-hidden="true" />
            Go to the map
          </Link>
          <Link to="/" className="btn-secondary">
            Back to the beginning
          </Link>
        </div>
      </div>
      <div className="pointer-events-none select-none overflow-hidden">
        <GiantWordmark text="LOST" className="text-[14vw] leading-[0.85]" strokeOnly />
      </div>
    </div>
  );
}
