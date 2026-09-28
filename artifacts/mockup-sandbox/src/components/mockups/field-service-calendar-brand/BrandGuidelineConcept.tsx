import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, Download, MapPin, MoreHorizontal, Plus, RefreshCw, Search,
  SlidersHorizontal, UserRound,
} from "lucide-react";
import "./BrandGuidelineConcept.css";

type Job = { day: number; time: string; title: string; customer: string; place: string; tone: string; flag?: string };
type Tech = { name: string; region: string; initials: string; jobs: Job[]; utilization: number };

const days = [
  ["MON", "JUN 30"], ["TUE", "JUL 1"], ["WED", "JUL 2"], ["THU", "JUL 3"],
  ["FRI", "JUL 4"], ["SAT", "JUL 5"], ["SUN", "JUL 6"],
];

const techs: Tech[] = [
  { name: "Gene Leitheiser", region: "R2", initials: "GL", utilization: 86, jobs: [
    { day: 0, time: "8:00 AM – 10:00 AM", title: "Annual HVAC Maintenance", customer: "Brookside Medical Center", place: "Columbus, OH", tone: "blue" },
    { day: 1, time: "9:30 AM – 11:00 AM", title: "Replace compressor", customer: "Lakeside Apartments", place: "Dublin, OH", tone: "yellow" },
    { day: 2, time: "1:00 PM – 3:00 PM", title: "Quarterly inspection", customer: "Northstar Foods", place: "Westerville, OH", tone: "blue" },
    { day: 4, time: "10:00 AM – 12:30 PM", title: "Air handler repair", customer: "Oakwood Senior Living", place: "Gahanna, OH", tone: "yellow" },
  ] },
  { name: "Steve Lockhart", region: "R2", initials: "SL", utilization: 72, jobs: [
    { day: 0, time: "10:30 AM – 12:00 PM", title: "Boiler troubleshooting", customer: "Riverbend School District", place: "Columbus, OH", tone: "purple" },
    { day: 2, time: "8:00 AM – 10:30 AM", title: "Preventive maintenance", customer: "Harrison Manufacturing", place: "Reynoldsburg, OH", tone: "purple" },
    { day: 3, time: "2:00 PM – 4:00 PM", title: "Rooftop unit service", customer: "The Grand Hotel", place: "Columbus, OH", tone: "blue" },
  ] },
  { name: "Brian Uniejewski", region: "R2", initials: "BU", utilization: 94, jobs: [
    { day: 0, time: "8:00 AM – 11:00 AM", title: "Chiller maintenance", customer: "Meridian Office Park", place: "Columbus, OH", tone: "yellow" },
    { day: 1, time: "12:00 PM – 2:00 PM", title: "Emergency service call", customer: "Cedar Grove Condos", place: "Hilliard, OH", tone: "red", flag: "Urgent" },
    { day: 3, time: "9:00 AM – 11:30 AM", title: "Cooling tower inspection", customer: "Westland Distribution", place: "Grove City, OH", tone: "yellow" },
    { day: 4, time: "1:00 PM – 3:00 PM", title: "Filter replacement", customer: "Riverside Dental", place: "Columbus, OH", tone: "yellow" },
  ] },
  { name: "Eric Vennemeyer", region: "R2", initials: "EV", utilization: 61, jobs: [
    { day: 1, time: "8:30 AM – 10:00 AM", title: "Thermostat installation", customer: "Pinnacle Fitness", place: "Powell, OH", tone: "blue" },
    { day: 2, time: "11:00 AM – 1:00 PM", title: "Heat pump repair", customer: "Franklin County Library", place: "Columbus, OH", tone: "blue" },
  ] },
  { name: "Matthew Piechoski", region: "R5", initials: "MP", utilization: 78, jobs: [
    { day: 0, time: "9:00 AM – 11:00 AM", title: "RTU diagnostics", customer: "Canton Commerce Center", place: "Canton, OH", tone: "pink" },
    { day: 2, time: "10:00 AM – 12:00 PM", title: "Spring startup", customer: "Summit Health Group", place: "Akron, OH", tone: "pink" },
    { day: 4, time: "8:00 AM – 10:00 AM", title: "Condensate drain repair", customer: "Maplewood Apartments", place: "Canton, OH", tone: "pink" },
  ] },
  { name: "George Hopf", region: "R5", initials: "GH", utilization: 68, jobs: [
    { day: 1, time: "1:00 PM – 3:30 PM", title: "Electrical inspection", customer: "Stark Industries", place: "Massillon, OH", tone: "orange" },
    { day: 3, time: "8:00 AM – 10:00 AM", title: "Compressor replacement", customer: "Pinecrest Mall", place: "Canton, OH", tone: "pink" },
  ] },
];

const unscheduled = [
  ["WO-10492", "AC not cooling", "Oak & Stone Realty", "Tomorrow", "2h 30m"],
  ["WO-10501", "Annual maintenance", "St. Mary's Clinic", "Jul 3", "1h 30m"],
  ["WO-10508", "Boiler inspection", "Fairfield Inn", "Jul 4", "2h"],
  ["WO-10513", "Replace fan motor", "Cardinal Logistics", "Unscheduled", "3h"],
];

function JobChip({ job }: { job: Job }) {
  return <div className={`fsb-job fsb-job-${job.tone}`}>
    <div className="fsb-job-top"><Clock3 size={11} /> <b>{job.time}</b>{job.flag && <span className="fsb-urgent">{job.flag}</span>}</div>
    <div className="fsb-job-title">{job.title}</div>
    <div className="fsb-job-customer">{job.customer}</div>
    <div className="fsb-job-place"><MapPin size={10} /> {job.place}</div>
  </div>;
}

export function BrandGuidelineConcept() {
  return <div className="fsb brand-guideline-concept">
    <header className="fsb-shell">
      <div className="fsb-brand"><CalendarDays size={22} /><span>Field Service Schedule Board</span></div>
      <nav><span className="fsb-nav-active"><CalendarDays size={15} /> Schedule Board</span><span>Work Orders</span><span>Reports</span></nav>
      <div className="fsb-account"><span className="fsb-avatar">JD</span><span>Jordan Davis</span><ChevronDown size={14} /></div>
    </header>
    <main className="fsb-main">
      <div className="fsb-heading"><div><h1>Schedule Board</h1><p>Plan and manage technician bookings across your service regions.</p></div><div className="fsb-heading-actions"><button><Download size={15} /> Export</button><button><RefreshCw size={15} /> Refresh</button></div></div>
      <section className="fsb-controls">
        <div className="fsb-date-control"><button aria-label="Previous week"><ChevronLeft size={16} /></button><button className="fsb-date-label">Jun 30 – Jul 6, 2025 <ChevronDown size={14} /></button><button aria-label="Next week"><ChevronRight size={16} /></button></div>
        <button className="fsb-today">Today</button><div className="fsb-divider" />
        <div className="fsb-select">Week <ChevronDown size={14} /></div><div className="fsb-select">All regions <ChevronDown size={14} /></div>
        <div className="fsb-search"><Search size={15} /><input placeholder="Search bookings..." /></div><button className="fsb-filter"><SlidersHorizontal size={15} /> Filters</button>
      </section>
      <div className="fsb-summary"><span><b>7</b> technicians</span><span><b>28</b> bookings</span><span><b>76%</b> average utilization</span><span className="fsb-summary-warning"><AlertTriangle size={14} /> 2 conflicts</span></div>
      <div className="fsb-layout">
        <section className="fsb-board">
          <div className="fsb-grid fsb-grid-head"><div className="fsb-tech-head">TECHNICIAN</div>{days.map(([dow, date]) => <div className="fsb-day-head" key={date}><strong>{dow}</strong><span>{date}</span></div>)}</div>
          {techs.map((tech) => <div className="fsb-grid fsb-row" key={tech.name}>
            <div className="fsb-tech"><div className={`fsb-tech-avatar fsb-region-${tech.region}`}>{tech.initials}</div><div className="fsb-tech-name"><b>{tech.name}</b><span>{tech.region} · <UserRound size={11} /> Technician</span></div><div className="fsb-util"><b>{tech.utilization}%</b><div><i style={{ width: `${tech.utilization}%` }} /></div></div></div>
            {days.map((_, day) => <div className={`fsb-cell ${day === 4 ? "fsb-weekend" : ""}`} key={day}>{tech.jobs.filter(j => j.day === day).map((job, i) => <JobChip job={job} key={i} />)}</div>)}
          </div>)}
        </section>
        <aside className="fsb-unscheduled"><div className="fsb-unscheduled-title"><div><h2>Unscheduled work</h2><span>4 jobs need attention</span></div><button><MoreHorizontal size={17} /></button></div><div className="fsb-unscheduled-search"><Search size={14} /><input placeholder="Search jobs..." /></div>{unscheduled.map(([id, title, customer, date, duration]) => <div className="fsb-unscheduled-card" key={id}><div className="fsb-card-line"><b>{id}</b><span className={date === "Unscheduled" ? "fsb-unassigned" : ""}>{date}</span></div><strong>{title}</strong><span className="fsb-card-customer">{customer}</span><div className="fsb-card-bottom"><span><Clock3 size={12} /> {duration}</span><button><Plus size={13} /> Assign</button></div></div>)}<button className="fsb-view-all">View all unscheduled jobs <ChevronRight size={14} /></button></aside>
      </div>
      <footer className="fsb-legend"><span><i className="legend-blue" /> Scheduled job</span><span><i className="legend-yellow" /> Potential conflict</span><span><i className="legend-gray" /> Travel / time off</span><span className="fsb-last-updated"><RefreshCw size={12} /> Last updated just now</span></footer>
    </main>
  </div>;
}