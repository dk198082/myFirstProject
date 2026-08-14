export default function Slide02WhatIs() {
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
          Dispatcher Training / 2026
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          position: 'absolute',
          top: '18vh',
          left: '8vw',
          right: '5vw',
          zIndex: 1,
        }}
      >
        <h2
          style={{
            color: '#111111',
            fontSize: '4vw',
            margin: '0 0 5vh 0',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          What Is the Schedule Board?
        </h2>

        <div style={{ display: 'flex', gap: '2.5vw' }}>
          {/* Card 1 */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              padding: '2.5vw 2vw',
              border: '1px solid #E0E0E0',
              boxShadow: '0 1vh 3vh rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                width: '2vw',
                height: '2vw',
                backgroundColor: '#3D5A80',
                marginBottom: '2vh',
              }}
            />
            <h3
              style={{
                color: '#111111',
                fontSize: '1.4vw',
                fontWeight: 700,
                margin: '0 0 1.5vh 0',
                letterSpacing: '-0.01em',
              }}
            >
              Central Planning Hub
            </h3>
            <p style={{ color: '#666666', fontSize: '1.1vw', lineHeight: 1.6, margin: 0 }}>
              Manage all field technician schedules in one place — jobs, travel
              blocks, and capacity at a glance.
            </p>
          </div>

          {/* Card 2 */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              padding: '2.5vw 2vw',
              border: '1px solid #E0E0E0',
              boxShadow: '0 1vh 3vh rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                width: '2vw',
                height: '2vw',
                backgroundColor: '#98C1D9',
                marginBottom: '2vh',
              }}
            />
            <h3
              style={{
                color: '#111111',
                fontSize: '1.4vw',
                fontWeight: 700,
                margin: '0 0 1.5vh 0',
                letterSpacing: '-0.01em',
              }}
            >
              Dynamics 365 Connected
            </h3>
            <p style={{ color: '#666666', fontSize: '1.1vw', lineHeight: 1.6, margin: 0 }}>
              Shows confirmed CRM bookings live. Changes sync back to
              Dynamics 365 Field Service automatically.
            </p>
          </div>

          {/* Card 3 */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              padding: '2.5vw 2vw',
              border: '1px solid #E0E0E0',
              boxShadow: '0 1vh 3vh rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                width: '2vw',
                height: '2vw',
                backgroundColor: '#EE6C4D',
                marginBottom: '2vh',
              }}
            />
            <h3
              style={{
                color: '#111111',
                fontSize: '1.4vw',
                fontWeight: 700,
                margin: '0 0 1.5vh 0',
                letterSpacing: '-0.01em',
              }}
            >
              Role-Based Access
            </h3>
            <p style={{ color: '#666666', fontSize: '1.1vw', lineHeight: 1.6, margin: 0 }}>
              Three roles control what you can do: <strong>Viewer</strong>{' '}
              (read-only), <strong>Editor</strong> (schedule changes),{' '}
              <strong>Admin</strong> (sync &amp; config).
            </p>
          </div>
        </div>

        {/* Bottom callout */}
        <div
          style={{
            marginTop: '3.5vh',
            padding: '2vh 2vw',
            backgroundColor: '#3D5A80',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5vw',
          }}
        >
          <div
            style={{
              color: '#FFFFFF',
              fontSize: '1.15vw',
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            The board is your primary tool for daily dispatch decisions. All
            changes made here flow directly into Dynamics 365 Field Service —
            no double-entry required.
          </div>
        </div>
      </div>

      {/* Slide number */}
      <div
        style={{
          position: 'absolute',
          bottom: '5vh',
          left: '5vw',
          color: '#999999',
          fontSize: '0.9vw',
          fontWeight: 600,
          zIndex: 1,
        }}
      >
        02
      </div>
    </div>
  );
}
