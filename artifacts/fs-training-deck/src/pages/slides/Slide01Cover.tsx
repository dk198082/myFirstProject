export default function Slide01Cover() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{
        backgroundColor: '#FAFAFA',
        fontFamily: "'Inter', sans-serif",
        backgroundImage:
          'linear-gradient(#F0F0F0 1px, transparent 1px), linear-gradient(to right, #F0F0F0 1px, transparent 1px)',
        backgroundSize: '5vw 5vh',
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1vw',
          height: '100vh',
          backgroundColor: '#3D5A80',
          zIndex: 1,
        }}
      />

      {/* Blue square - top left */}
      <div
        style={{
          position: 'absolute',
          top: '5vh',
          left: '5vw',
          width: '3vw',
          height: '3vw',
          backgroundColor: '#3D5A80',
          zIndex: 1,
        }}
      />

      {/* Company label - top right */}
      <div
        style={{
          position: 'absolute',
          top: '5vh',
          right: '5vw',
          zIndex: 1,
          textAlign: 'right',
        }}
      >
        <div
          style={{
            color: '#3D5A80',
            fontSize: '0.9vw',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '0.5vh',
          }}
        >
          Field Service Schedule Board
        </div>
        <div
          style={{
            color: '#999999',
            fontSize: '0.8vw',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Confidential / 2026
        </div>
      </div>

      {/* Main content - bottom left */}
      <div
        style={{
          position: 'absolute',
          bottom: '10vh',
          left: '8vw',
          zIndex: 1,
          maxWidth: '65vw',
        }}
      >
        <div
          style={{
            color: '#3D5A80',
            fontSize: '1.1vw',
            fontWeight: 600,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom: '2.5vh',
          }}
        >
          Training Guide
        </div>
        <h1
          style={{
            color: '#111111',
            fontSize: '7vw',
            margin: '0 0 2.5vh 0',
            fontWeight: 800,
            lineHeight: 1.0,
            letterSpacing: '-0.03em',
            textWrap: 'balance',
          }}
        >
          Field Service
          <br />
          Schedule Board
        </h1>
        <p
          style={{
            color: '#666666',
            fontSize: '1.8vw',
            margin: 0,
            fontWeight: 400,
            lineHeight: 1.4,
          }}
        >
          Dispatcher Training Guide &nbsp;·&nbsp; August 2026
        </p>
      </div>

      {/* Decorative right panel */}
      <div
        style={{
          position: 'absolute',
          top: '15vh',
          right: '5vw',
          width: '24vw',
          zIndex: 1,
        }}
      >
        {/* Mini board mockup */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E0E0E0',
            boxShadow: '0 2vh 4vh rgba(0,0,0,0.06)',
            padding: '2vh 1.5vw',
          }}
        >
          <div
            style={{
              color: '#3D5A80',
              fontSize: '0.85vw',
              fontWeight: 700,
              marginBottom: '1.5vh',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Weekly Schedule
          </div>
          {/* Row 1 */}
          <div
            style={{
              display: 'flex',
              gap: '0.4vw',
              marginBottom: '1.2vh',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '4vw',
                fontSize: '0.65vw',
                color: '#666666',
                fontWeight: 600,
              }}
            >
              Tech A
            </div>
            <div
              style={{
                flex: 2,
                height: '3vh',
                backgroundColor: '#3D5A80',
                borderRadius: '2px',
                opacity: 0.85,
              }}
            />
            <div style={{ flex: 1, height: '3vh', backgroundColor: '#98C1D9', borderRadius: '2px' }} />
            <div style={{ flex: 1, height: '3vh' }} />
          </div>
          {/* Row 2 */}
          <div
            style={{
              display: 'flex',
              gap: '0.4vw',
              marginBottom: '1.2vh',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '4vw',
                fontSize: '0.65vw',
                color: '#666666',
                fontWeight: 600,
              }}
            >
              Tech B
            </div>
            <div style={{ flex: 1, height: '3vh' }} />
            <div
              style={{
                flex: 2,
                height: '3vh',
                backgroundColor: '#F4C430',
                borderRadius: '2px',
                opacity: 0.9,
              }}
            />
            <div
              style={{
                flex: 1,
                height: '3vh',
                backgroundColor: '#3D5A80',
                borderRadius: '2px',
                opacity: 0.85,
              }}
            />
          </div>
          {/* Row 3 */}
          <div
            style={{
              display: 'flex',
              gap: '0.4vw',
              marginBottom: '1.2vh',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '4vw',
                fontSize: '0.65vw',
                color: '#666666',
                fontWeight: 600,
              }}
            >
              Tech C
            </div>
            <div
              style={{
                flex: 1,
                height: '3vh',
                backgroundColor: '#EE6C4D',
                borderRadius: '2px',
                opacity: 0.85,
              }}
            />
            <div style={{ flex: 1, height: '3vh' }} />
            <div
              style={{
                flex: 2,
                height: '3vh',
                backgroundColor: '#98C1D9',
                borderRadius: '2px',
              }}
            />
          </div>
          {/* Row 4 */}
          <div
            style={{
              display: 'flex',
              gap: '0.4vw',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '4vw',
                fontSize: '0.65vw',
                color: '#666666',
                fontWeight: 600,
              }}
            >
              Tech D
            </div>
            <div
              style={{
                flex: 3,
                height: '3vh',
                backgroundColor: '#3D5A80',
                borderRadius: '2px',
                opacity: 0.85,
              }}
            />
            <div style={{ flex: 1, height: '3vh' }} />
          </div>
          {/* Utilization bar */}
          <div style={{ marginTop: '2vh', borderTop: '1px solid #F0F0F0', paddingTop: '1vh' }}>
            <div
              style={{ fontSize: '0.6vw', color: '#999999', fontWeight: 600, marginBottom: '0.5vh', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Utilization
            </div>
            <div style={{ height: '0.8vh', backgroundColor: '#F0F0F0', borderRadius: '2px' }}>
              <div
                style={{ width: '72%', height: '100%', backgroundColor: '#3D5A80', borderRadius: '2px' }}
              />
            </div>
          </div>
        </div>

        {/* Role tags */}
        <div style={{ display: 'flex', gap: '0.5vw', marginTop: '2vh', flexWrap: 'wrap' }}>
          <div
            style={{
              backgroundColor: '#3D5A80',
              color: '#FFFFFF',
              fontSize: '0.7vw',
              fontWeight: 600,
              padding: '0.5vh 1vw',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Viewer
          </div>
          <div
            style={{
              backgroundColor: '#98C1D9',
              color: '#FFFFFF',
              fontSize: '0.7vw',
              fontWeight: 600,
              padding: '0.5vh 1vw',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Editor
          </div>
          <div
            style={{
              backgroundColor: '#111111',
              color: '#FFFFFF',
              fontSize: '0.7vw',
              fontWeight: 600,
              padding: '0.5vh 1vw',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Admin
          </div>
        </div>
      </div>

      {/* Bottom rule */}
      <div
        style={{
          position: 'absolute',
          bottom: '8vh',
          right: '5vw',
          color: '#999999',
          fontSize: '0.9vw',
          fontWeight: 600,
          zIndex: 1,
        }}
      >
        01
      </div>
    </div>
  );
}
