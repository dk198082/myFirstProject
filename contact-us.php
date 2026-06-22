
<?php include 'header.php';?>


    <!--HEADER END-->
    <!--BANNER START-->
    <div class="kode-inner-banner">
    	<div class="kode-page-heading">
        	<h2>Photo Gallery</h2>
            <ol class="breadcrumb">
              <li><a href="#">Home</a></li>
              <li><a href="#">Library</a></li>
              <li class="active">Gallery</li>
            </ol>
        </div>
    </div>
    <!--BANNER END-->
    <div class="search-section">
        <div class="container">
			<!-- Nav tabs -->
			  <ul class="nav nav-tabs" role="tablist">
				<li role="presentation"><a href="#Basic" aria-controls="Basic" role="tab" data-toggle="tab">Basic</a></li>
				<li role="presentation" class="active"><a href="#Author" aria-controls="Author" role="tab" data-toggle="tab">Author</a></li>
				<li role="presentation"><a href="#Publications" aria-controls="Publications" role="tab" data-toggle="tab">Publications</a></li>
			  </ul>
			
			  <!-- Tab panes -->
			  <div class="tab-content">
				<div role="tabpanel" class="tab-pane active" id="Basic">
					<div class="form-container">
						<div class="row">
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="First Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Middle Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Last Name">
							</div>
							<div class="col-md-3 col-sm-12">
								<button>Search Author</button>
							</div>
						</div>
					</div>
				</div>
				<div role="tabpanel" class="tab-pane" id="Author">
					<div class="form-container">
						<div class="row">
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="First Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Middle Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Last Name">
							</div>
							<div class="col-md-3 col-sm-12">
								<button>Search Author</button>
							</div>
						</div>
					</div>
				</div>
				<div role="tabpanel" class="tab-pane" id="Publications">
					<div class="form-container">
						<div class="row">
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="First Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Middle Name">
							</div>
							<div class="col-md-3 col-sm-4">
								<input type="text" placeholder="Last Name">
							</div>
							<div class="col-md-3 col-sm-12">
								<button>Search Author</button>
							</div>
						</div>
					</div>
				</div>
			  </div>
		</div>
    </div>
    <!--CONTENT START-->
   <div class="kode-content padding-tb-50">
    	<div class="container">
            <!--LOCATION MAP START-->
            <div class="location-map">
                <div class="map-canvas" id="map-canvas"></div>
            </div>
            <!--LOCATION MAP END-->
            <div class="row">
                <div class="col-md-8">
                    <div class="comment-form">
                        <div class="row">
							<form method="post" class="comments-form" id="contactform">
								<div class="col-md-4 col-sm-4">
									<div class="input-container">
										<input type="text" id="name" name="name" class="required" placeholder="Name *" />
										<label for="name">Name</label>
									</div>
								</div>
								<div class="col-md-4 col-sm-4">
									<div class="input-container">
										<input type="text" id="email" name="email" class="required email" placeholder="Email *" >
										<label for="email">Email</label>
									</div>
								</div>
								<div class="col-md-4 col-sm-4">
									<div class="input-container">
										<input type="text" id="phone" name="phone" class="required" placeholder="Phone *" >
										<label for="phone">Phone</label>
									</div>
								</div>
								<div class="col-md-12 col-sm-12">
									<div class="input-container">
										<textarea name="message" id="message" placeholder="add your comment"></textarea>
										<label for="message">Message</label>
									</div>
								</div>
								<div class="col-md-6">
									<p class="input-block kf_capcha">
										<label for="verify">Are you human?</label>
										<iframe src="inc/capcha_page.html" height="29" width="80" scrolling="no" frameborder="0" marginheight="0" marginwidth="0" class="capcha_image_frame" name="capcha_image_frame"></iframe>
										<input class="verify" type="text" id="verify" name="verify" />
									</p>
								</div>						
								<div class="col-md-6">
									<p class="kd-button kf_submit widget-newslatter pull-right"><input class="thbg-color" type="submit" value="Submit Comments"></p>
								</div>
							</form>
                        </div>
                    </div>
                </div>
                <div class="col-md-4 sidebar">
                    <div class="widget widget-text">
                        <h2>get in touch</h2>
                        <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident</p>
                    </div>
                    <div class="widget widget-text">
                        <h2>Information</h2>
                        <ul>
                           <li><i class="fa fa-map-marker"></i>Nemo enim ipsam voluptatem quia voluptas sit</li>
                           <li><i class="fa fa-phone"></i>(25) 82 800 80</li>
                           <li><i class="fa fa-envelope"></i><a href="mailto:info@librarytheme.com">info@librarytheme.com</a></li> 
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div> 
	<section class="kode-uptodate">
		<div class="container">
			<div class="row">
				<div class="col-md-4">
					<h2>stay up-to-dated</h2>
				</div>
				<div class="col-md-8">
					<div class="row">
						<div class="col-md-3">
							<div class="social-icons">
								<ul>
									<li><a href="#"><i class="fa fa-facebook"></i></a></li>
									<li><a href="#"><i class="fa fa-google-plus"></i></a></li>
									<li><a href="#"><i class="fa fa-twitter"></i></a></li>
									<li><a href="#"><i class="fa fa-pinterest-p"></i></a></li>
								</ul>
							</div>
						</div>
						<div class="col-md-9">
							<div class="input-container">
								<input type="text" placeholder="Your E-mail Address" id="sub-2">
								<button>Subscribe</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>
    <!--CONTENT END-->
     <?php include 'footer.php';?>