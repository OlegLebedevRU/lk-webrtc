// We import the settings.js file to know which address we should contact
// to talk to Janus, and optionally which STUN/TURN servers should be
// used as well. Specifically, that file defines the "server" and
// "iceServers" properties we'll pass when creating the Janus session.

/* global iceServers:readonly, Janus:readonly, server:readonly */

var janus = null;
var streaming = null;
var sipcall = null;
var opaqueId = "streamingtest-"+Janus.randomString(12);
var opaqueIdSip = "siptest-"+Janus.randomString(12);
var remoteTracks = {}, remoteVideos = 0, localTracks = {}, localVideos = 0, dataMid = null;
var bitrateTimer = {};

var simulcastStarted = {}, svcStarted = {};

var streamsList = {};
var selectedStream = null;
var selectedApproach = null;
var registered = false;
var masterId = null, helpers = {}, helpersCount = 0;

var incoming = null;

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		//$('#start').one('click', function() {
		//	$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				bootbox.alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: server,
					iceServers: iceServers,
					// Should the Janus API require authentication, you can specify either the API secret or user token here too
					//		token: "mytoken",
					//	or
					//		apisecret: "serversecret",
					success: function() {
						// Attach to Streaming plugin
						janus.attach(
							{
								plugin: "janus.plugin.streaming",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
								//	$('#details').remove();
									streaming = pluginHandle;
									Janus.log("Plugin attached! (" + streaming.getPlugin() + ", id=" + streaming.getId() + ")");
									// Setup streaming session
									$('#update-streams').click(updateStreamsList);
									updateStreamsList();
								//	$('#start').removeAttr('disabled').html("Stop")
								//		.click(function() {
								//			$(this).attr('disabled', true);
								//			for(let i in bitrateTimer)
								//				clearInterval(bitrateTimer[i]);
								//			bitrateTimer = {};
								//			janus.destroy();
								//			$('#streamslist').attr('disabled', true);
								//			$('#watch').attr('disabled', true).unbind('click');
								//			$('#start').attr('disabled', true).html("Bye").unbind('click');
								//		});
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin... ", error);
									bootbox.alert("Error attaching plugin... " + error);
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
								},
								slowLink: function(uplink, lost, mid) {
									Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
										" packets on mid " + mid + " (" + lost + " lost packets)");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::", msg);
									let result = msg["result"];
									if(result) {
										if(result["status"]) {
											let status = result["status"];
											if(status === 'starting')
												$('#status').removeClass('hide').text("Starting, please wait...").removeClass('hide');
											else if(status === 'started')
												$('#status').removeClass('hide').text("Started").removeClass('hide');
											else if(status === 'stopped')
												stopStream();
										} else if(msg["streaming"] === "event") {
											// Does this event refer to a mid in particular?
											let mid = result["mid"] ? result["mid"] : "0";
											// Is simulcast in place?
											let substream = result["substream"];
											let temporal = result["temporal"];
											if((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
												if(!simulcastStarted[mid]) {
													simulcastStarted[mid] = true;
													addSimulcastButtons(mid);
												}
												// We just received notice that there's been a switch, update the buttons
												updateSimulcastButtons(mid, substream, temporal);
											}
											// Is VP9/SVC in place?
											let spatial = result["spatial_layer"];
											temporal = result["temporal_layer"];
											if((spatial !== null && spatial !== undefined) || (temporal !== null && temporal !== undefined)) {
												if(!svcStarted[mid]) {
													svcStarted[mid] = true;
													addSvcButtons(mid);
												}
												// We just received notice that there's been a switch, update the buttons
												updateSvcButtons(mid, spatial, temporal);
											}
										}
									} else if(msg["error"]) {
										bootbox.alert(msg["error"]);
										stopStream();
										return;
									}
									if(jsep) {
										Janus.debug("Handling SDP as well...", jsep);
										let stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
										// Offer from the plugin, let's answer
										streaming.createAnswer(
											{
												jsep: jsep,
												// We only specify data channels here, as this way in
												// case they were offered we'll enable them. Since we
												// don't mention audio or video tracks, we autoaccept them
												// as recvonly (since we won't capture anything ourselves)
												tracks: [
													{ type: 'data' }
												],
												customizeSdp: function(jsep) {
													if(stereo && jsep.sdp.indexOf("stereo=1") == -1) {
														// Make sure that our offer contains stereo too
														jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
													}
												},
												success: function(jsep) {
													Janus.debug("Got SDP!", jsep);
													let body = { request: "start" };
													streaming.send({ message: body, jsep: jsep });
													$('#watch').html("Stop").removeAttr('disabled').unbind('click').click(stopStream);
												},
												error: function(error) {
													Janus.error("WebRTC error:", error);
													bootbox.alert("WebRTC error... " + error.message);
												}
											});
									}
								},
								onremotetrack: function(track, mid, on, metadata) {
									Janus.debug(
										"Remote track (mid=" + mid + ") " +
										(on ? "added" : "removed") +
										(metadata ? " (" + metadata.reason + ") ": "") + ":", track
									);
									let mstreamId = "mstream"+mid;
									if(streamsList[selectedStream] && streamsList[selectedStream].legacy)
										mstreamId = "mstream0";
									if(!on) {
										// Track removed, get rid of the stream and the rendering
										$('#remotevideo' + mid).remove();
										if(track.kind === "video") {
											remoteVideos--;
											if(remoteVideos === 0) {
												// No video, at least for now: show a placeholder
												if($('#'+mstreamId+' .no-video-container').length === 0) {
													$('#'+mstreamId).append(
														'<div class="no-video-container">' +
														'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
														'<span class="no-video-text">No remote video available</span>' +
													'</div>');
												}
											}
										}
										delete remoteTracks[mid];
										return;
									}
									if($('#remotevideo' + mid).length > 0)
										return;
									// If we're here, a new track was added
									$('#spinner' + mid).remove();
									let stream = null;
									if(track.kind === "audio") {
										// New audio track: create a stream out of it, and use a hidden <audio> element
										stream = new MediaStream([track]);
										remoteTracks[mid] = stream;
										Janus.log("Created remote audio stream:", stream);
										$('#'+mstreamId).append('<audio class="hide" id="remotevideo' + mid + '" playsinline/>');
										$('#remotevideo'+mid).get(0).volume = 0;
										if(remoteVideos === 0) {
											// No video, at least for now: show a placeholder
											if($('#'+mstreamId+' .no-video-container').length === 0) {
												$('#'+mstreamId).append(
													'<div class="no-video-container audioonly">' +
														'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
														'<span class="no-video-text">No video available</span>' +
													'</div>');
											}
										}
									} else {
										// New video track: create a stream out of it
										remoteVideos++;
										$('.no-video-container').remove();
										stream = new MediaStream([track]);
										remoteTracks[mid] = stream;
										Janus.log("Created remote video stream:", stream);
										$('#'+mstreamId).append('<video class="rounded centered hide" id="remotevideo' + mid + '" width="100%" height="100%" playsinline/>');
										$('#remotevideo'+mid).get(0).volume = 0;
										// Use a custom timer for this stream
										if(!bitrateTimer[mid]) {
											$('#curbitrate'+mid).removeClass('hide');
											bitrateTimer[mid] = setInterval(function() {
												if(!$("#remotevideo" + mid).get(0))
													return;
												// Display updated bitrate, if supported
												let bitrate = streaming.getBitrate(mid);
												$('#curbitrate'+mid).text(bitrate);
												// Check if the resolution changed too
												let width = $("#remotevideo" + mid).get(0).videoWidth;
												let height = $("#remotevideo" + mid).get(0).videoHeight;
												if(width > 0 && height > 0)
													$('#curres'+mid).removeClass('hide').text(width+'x'+height).removeClass('hide');
											}, 1000);
										}
									}
									// Play the stream when we get a playing event
									$("#remotevideo" + mid).bind("playing", function (ev) {
										$('.waitingvideo').remove();
										if(!this.videoWidth)
											return;
										$('#'+ev.target.id).removeClass('hide');
										let width = this.videoWidth;
										let height = this.videoHeight;
										$('#curres'+mid).removeClass('hide').text(width+'x'+height).removeClass('hide');
										if(Janus.webRTCAdapter.browserDetails.browser === "firefox") {
											// Firefox Stable has a bug: width and height are not immediately available after a playing
											setTimeout(function() {
												let width = $('#'+ev.target.id).get(0).videoWidth;
												let height = $('#'+ev.target.id).get(0).videoHeight;
												$('#curres'+mid).removeClass('hide').text(width+'x'+height).removeClass('hide');
											}, 2000);
										}
									});
									Janus.attachMediaStream($('#remotevideo' + mid).get(0), stream);
									$('#remotevideo' + mid).get(0).play();
									$('#remotevideo' + mid).get(0).volume = 1;
								},
								// eslint-disable-next-line no-unused-vars
								ondataopen: function(label, protocol) {
									Janus.log("The DataChannel is available!");
									$('.waitingvideo').remove();
									$('#mstream' + dataMid).append(
										'<input class="form-control" type="text" id="datarecv" disabled></input>'
									);
								},
								ondata: function(data) {
									Janus.debug("We got data from the DataChannel!", data);
									$('#datarecv').val(data);
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									$('#videos').empty();
									$('#info').addClass('hide');
									for(let i in bitrateTimer)
										clearInterval(bitrateTimer[i]);
									bitrateTimer = {};
									simulcastStarted = false;
									remoteTracks = {};
									remoteVideos = 0;
									dataMid = null;
									$('#streamset').removeAttr('disabled');
									$('#streamslist').removeAttr('disabled');
									$('#watch').html("Watch").removeAttr('disabled')
										.unbind('click').click(startStream);
								}
							});
							janus.attach(
								{
									plugin: "janus.plugin.sip",
									opaqueId: opaqueIdSip,
									success: function(pluginHandle1) {
									
										sipcall = pluginHandle1;
										Janus.log("Plugin attached! (" + sipcall.getPlugin() + ", id=" + sipcall.getId() + ")");
										// Prepare the username registration
										//registerUsername();
									},
									error: function(error) {
										Janus.error("  -- Error attaching plugin...", error);
										bootbox.alert("  -- Error attaching plugin... " + error);
									},
									webrtcState: function(on) {
										Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
										$("#videoleft").parent().unblock();
									},
									slowLink: function(uplink, lost, mid) {
										Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
											" packets on mid " + mid + " (" + lost + " lost packets)");
									},
									onmessage: function(msg, jsep) {
										Janus.debug(" ::: Got a message :::", msg);
										// Any error?
										let error = msg["error"];
										if(error) {
											if(!registered) {
												// $('#server').removeAttr('disabled');
												// $('#username').removeAttr('disabled');
												// $('#authuser').removeAttr('disabled');
												// $('#displayname').removeAttr('disabled');
												// $('#password').removeAttr('disabled');
												// $('#register').removeAttr('disabled').click(registerUsername);
												// $('#registerset').removeAttr('disabled');
											} else {
												// Reset status
												sipcall.hangup();
											//	$('#dovideo').removeAttr('disabled').val('');
												$('#peer').removeAttr('disabled').val('');
												$('#call').removeAttr('disabled').html('Call')
													.removeClass("btn-danger").addClass("btn-success")
													.unbind('click').click(doCall);
											}
											bootbox.alert(error);
											return;
										}
										let callId = msg["call_id"];
										let result = msg["result"];
										if(result && result["event"]) {
											let event = result["event"];
											if(event === 'registration_failed') {
												Janus.warn("Registration failed: " + result["code"] + " " + result["reason"]);
												$('#server').removeAttr('disabled');
												$('#username').removeAttr('disabled');
												$('#authuser').removeAttr('disabled');
												$('#displayname').removeAttr('disabled');
												$('#password').removeAttr('disabled');
												$('#register').removeAttr('disabled').click(registerUsername);
												$('#registerset').removeAttr('disabled');
												bootbox.alert(result["code"] + " " + result["reason"]);
												return;
											}
											if(event === 'registered') {
												Janus.log("Successfully registered as " + result["username"] + "!");
												$('#you').removeClass('hide').text("Registered as '" + result["username"] + "'");
												// TODO Enable buttons to call now
												if(!registered) {
													registered = true;
													masterId = result["master_id"];
													// $('#server').parent().addClass('hide');
													// $('#authuser').parent().addClass('hide');
													// $('#displayname').parent().addClass('hide');
													// $('#password').parent().addClass('hide');
													// $('#register').parent().addClass('hide');
													// $('#registerset').parent().addClass('hide');
													// //$('#addhelper').removeClass('hide').click(addHelper);
													$('#phone').removeClass('invisible').removeClass('hide');
													$('#call').unbind('click').click(doCall);
													$('#peer').focus();
												}
											} else if(event === 'calling') {
												Janus.log("Waiting for the peer to answer...");
												// TODO Any ringtone?
												$('#call').removeAttr('disabled').html('Hangup')
													.removeClass("btn-success").addClass("btn-danger")
													.unbind('click').click(doHangup);
											} else if(event === 'incomingcall') {
												Janus.log("Incoming call from " + result["username"] + "!");
												sipcall.callId = callId;
												let doAudio = true; //, doVideo = true;
												let offerlessInvite = false;
												if(jsep) {
													// What has been negotiated?
													doAudio = (jsep.sdp.indexOf("m=audio ") > -1);
													//doVideo = (jsep.sdp.indexOf("m=video ") > -1);
													Janus.debug("Audio " + (doAudio ? "has" : "has NOT") + " been negotiated");
													//Janus.debug("Video " + (doVideo ? "has" : "has NOT") + " been negotiated");
												} else {
													Janus.log("This call doesn't contain an offer... we'll need to provide one ourselves");
													offerlessInvite = true;
													// In case you want to offer video when reacting to an offerless call, set this to true
													//doVideo = false;
												}
												// Is this the result of a transfer?
												// let transfer = "";
												// let referredBy = result["referred_by"];
												// if(referredBy) {
												// 	transfer = " (referred by " + referredBy + ")";
												// 	transfer = transfer.replace(new RegExp('<', 'g'), '&lt');
												// 	transfer = transfer.replace(new RegExp('>', 'g'), '&gt');
												// }
												// Any security offered? A missing "srtp" attribute means plain RTP
												let rtpType = "";
												let srtp = result["srtp"];
												if(srtp === "sdes_optional")
													rtpType = " (SDES-SRTP offered)";
												else if(srtp === "sdes_mandatory")
													rtpType = " (SDES-SRTP mandatory)";
												// Notify user
												bootbox.hideAll();
												let extra = "";
												if(offerlessInvite)
													extra = " (no SDP offer provided)"
												incoming = bootbox.dialog({
													message: "Incoming call from " + result["username"] + "!" + rtpType + extra,
													title: "Incoming call",
													closeButton: false,
													buttons: {
														success: {
															label: "Answer",
															className: "btn-success",
															callback: function() {
																incoming = null;
																$('#peer').val(result["username"]).attr('disabled', true);
																// Notice that we can only answer if we got an offer: if this was
																// an offerless call, we'll need to create an offer ourselves
																let sipcallAction = (offerlessInvite ? sipcall.createOffer : sipcall.createAnswer);
																// We want bidirectional audio and/or video
																let tracks = [];
																if(doAudio)
																	tracks.push({ type: 'audio', capture: true, recv: true });
																// if(doVideo)
																// 	tracks.push({ type: 'video', capture: true, recv: true });
																sipcallAction(
																	{
																		jsep: jsep,
																		tracks: tracks,
																		success: function(jsep) {
																			Janus.debug("Got SDP " + jsep.type + "! audio=" + doAudio + ", video=" +  ":", jsep);
																			sipcall.doAudio = doAudio;
																			//sipcall.doVideo = doVideo;
																			let body = { request: "accept" };
																			// Note: as with "call", you can add a "srtp" attribute to
																			// negotiate/mandate SDES support for this incoming call.
																			// The default behaviour is to automatically use it if
																			// the caller negotiated it, but you may choose to require
																			// SDES support by setting "srtp" to "sdes_mandatory", e.g.:
																			//		let body = { request: "accept", srtp: "sdes_mandatory" };
																			// This way you'll tell the plugin to accept the call, but ONLY
																			// if SDES is available, and you don't want plain RTP. If it
																			// is not available, you'll get an error (452) back. You can
																			// also specify the SRTP profile to negotiate by setting the
																			// "srtp_profile" property accordingly (the default if not
																			// set in the request is "AES_CM_128_HMAC_SHA1_80")
																			// Note 2: by default, the SIP plugin auto-answers incoming
																			// re-INVITEs, without involving the browser/client: this is
																			// for backwards compatibility with older Janus clients that
																			// may not be able to handle them. Since we want to receive
																			// re-INVITES to handle them ourselves, we specify it here:
																			body["autoaccept_reinvites"] = false;
																			sipcall.send({ message: body, jsep: jsep });
																			$('#call').removeAttr('disabled').html('Hangup')
																				.removeClass("btn-success").addClass("btn-danger")
																				.unbind('click').click(doHangup);
																		},
																		error: function(error) {
																			Janus.error("WebRTC error:", error);
																			bootbox.alert("WebRTC error... " + error.message);
																			// Don't keep the caller waiting any longer, but use a 480 instead of the default 486 to clarify the cause
																			let body = { request: "decline", code: 480 };
																			sipcall.send({ message: body });
																		}
																	});
															}
														},
														danger: {
															label: "Decline",
															className: "btn-danger",
															callback: function() {
																incoming = null;
																let body = { request: "decline" };
																sipcall.send({ message: body });
															}
														}
													}
												});
											} else if(event === 'accepting') {
												// Response to an offerless INVITE, let's wait for an 'accepted'
											} else if(event === 'progress') {
												Janus.log("There's early media from " + result["username"] + ", wairing for the call!", jsep);
												// Call can start already: handle the remote answer
												if(jsep) {
													sipcall.handleRemoteJsep({ jsep: jsep, error: doHangup });
												}
												toastr.info("Early media...");
											} else if(event === 'accepted') {
												Janus.log(result["username"] + " accepted the call!", jsep);
												// Call can start, now: handle the remote answer
												if(jsep) {
													sipcall.handleRemoteJsep({ jsep: jsep, error: doHangup });
												}
												toastr.success("Call accepted!");
												sipcall.callId = callId;
											} else if(event === 'updatingcall') {
												// We got a re-INVITE: while we may prompt the user (e.g.,
												// to notify about media changes), to keep things simple
												// we just accept the update and send an answer right away
												Janus.log("Got re-INVITE");
												let doAudio = (jsep.sdp.indexOf("m=audio ") > -1); //,
													//doVideo = (jsep.sdp.indexOf("m=video ") > -1);
												// We want bidirectional audio and/or video, but only
												// populate tracks if we weren't sending something before
												let tracks = [];
												if(doAudio && !sipcall.doAudio) {
													sipcall.doAudio = true;
													tracks.push({ type: 'audio', capture: true, recv: true });
												}
												// if(doVideo && !sipcall.doVideo) {
												// 	sipcall.doVideo = true;
												// 	tracks.push({ type: 'video', capture: true, recv: true });
												// }
												sipcall.createAnswer(
													{
														jsep: jsep,
														tracks: tracks,
														success: function(jsep) {
															Janus.debug("Got SDP " + jsep.type + "! audio=" + doAudio + ", video=" +  ":", jsep);
															let body = { request: "update" };
															sipcall.send({ message: body, jsep: jsep });
														},
														error: function(error) {
															Janus.error("WebRTC error:", error);
															bootbox.alert("WebRTC error... " + error.message);
														}
													});
											} else if(event === 'message') {
												// We got a MESSAGE
												let sender = result["displayname"] ? result["displayname"] : result["sender"];
												let content = result["content"];
												content = content.replace(new RegExp('<', 'g'), '&lt');
												content = content.replace(new RegExp('>', 'g'), '&gt');
												toastr.success(content, "Message from " + sender);
											} else if(event === 'info') {
												// We got an INFO
												let sender = result["displayname"] ? result["displayname"] : result["sender"];
												let content = result["content"];
												content = content.replace(new RegExp('<', 'g'), '&lt');
												content = content.replace(new RegExp('>', 'g'), '&gt');
												toastr.info(content, "Info from " + sender);
											} else if(event === 'notify') {
												// We got a NOTIFY
												let notify = result["notify"];
												let content = result["content"];
												toastr.info(content, "Notify (" + notify + ")");
											} else if(event === 'hangup') {
												if(incoming != null) {
													incoming.modal('hide');
													incoming = null;
												}
												Janus.log("Call hung up (" + result["code"] + " " + result["reason"] + ")!");
												bootbox.alert(result["code"] + " " + result["reason"]);
												// Reset status
												sipcall.hangup();
												//$('#dovideo').removeAttr('disabled').val('');
												$('#peer').removeAttr('disabled').val('');
												$('#call').removeAttr('disabled').html('Call')
													.removeClass("btn-danger").addClass("btn-success")
													.unbind('click').click(doCall);
											} else if(event === 'messagedelivery') {
												// message delivery status
												let reason = result["reason"];
												let code = result["code"];
												let callid = msg['call_id'];
												if (code == 200) {
													toastr.success(`${callid} Delivery Status: ${code} ${reason}`);
												} else {
													toastr.error(`${callid} Delivery Status: ${code} ${reason}`);
												}
											}
										}
									},
									onlocaltrack: function(track, on) {
										Janus.debug("Local track " + (on ? "added" : "removed") + ":", track);
										// We use the track ID as name of the element, but it may contain invalid characters
										let trackId = track.id.replace(/[{}]/g, "");
										if(!on) {
											// Track removed, get rid of the stream and the rendering
											let stream = localTracks[trackId];
											if(stream) {
												try {
													let tracks = stream.getTracks();
													for(let i in tracks) {
														let mst = tracks[i];
														if(mst)
															mst.stop();
													}
												// eslint-disable-next-line no-unused-vars
												} catch(e) {}
											}
											if(track.kind === "video") {
												// $('#myvideot' + trackId).remove();
												// localVideos--;
												// if(localVideos === 0) {
												// 	// No video, at least for now: show a placeholder
												// 	if($('#videoleft .no-video-container').length === 0) {
												// 		$('#videoleft').append(
												// 			'<div class="no-video-container">' +
												// 				'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
												// 				'<span class="no-video-text">No webcam available</span>' +
												// 			'</div>');
												// 	}
												// }
											}
											delete localTracks[trackId];
											return;
										}
										// If we're here, a new track was added
										let stream = localTracks[trackId];
										if(stream) {
											// We've been here already
											return;
										}
										// if($('#videoleft video').length === 0) {
										// 	$('#videos').removeClass('hide');
										// }
										if(track.kind === "audio") {
											// // We ignore local audio tracks, they'd generate echo anyway
											// if(localVideos === 0) {
											// 	// No video, at least for now: show a placeholder
											// 	if($('#videoleft .no-video-container').length === 0) {
											// 		$('#videoleft').append(
											// 			'<div class="no-video-container">' +
											// 				'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
											// 				'<span class="no-video-text">No webcam available</span>' +
											// 			'</div>');
											// 	}
											// }
										} else {
											// // New video track: create a stream out of it
											// localVideos++;
											// $('#videoleft .no-video-container').remove();
											// stream = new MediaStream([track]);
											// localTracks[trackId] = stream;
											// Janus.log("Created local stream:", stream);
											// $('#videoleft').append('<video class="rounded centered" id="myvideot' + trackId + '" width="100%" height="100%" autoplay playsinline muted="muted"/>');
											// Janus.attachMediaStream($('#myvideot' + trackId).get(0), stream);
										}
										if(sipcall.webrtcStuff.pc.iceConnectionState !== "completed" &&
												sipcall.webrtcStuff.pc.iceConnectionState !== "connected") {
											$("#videoleft").parent().block({
												message: '<b>Calling...</b>',
												css: {
													border: 'none',
													backgroundColor: 'transparent',
													color: 'white'
												}
											});
										}
									},
									onremotetrack: function(track, mid, on) {
										Janus.debug("Remote track (mid=" + mid + ") " + (on ? "added" : "removed") + ":", track);
										if(!on) {
											// Track removed, get rid of the stream and the rendering
											$('#peervideom' + mid).remove();
											if(track.kind === "video") {
												// remoteVideos--;
												// if(remoteVideos === 0) {
												// 	// No video, at least for now: show a placeholder
												// 	if($('#videoright .no-video-container').length === 0) {
												// 		$('#videoright').append(
												// 			'<div class="no-video-container">' +
												// 				'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
												// 				'<span class="no-video-text">No remote video available</span>' +
												// 			'</div>');
												// 	}
												// }
											}
											delete remoteTracks[mid];
											return;
										}
										// If we're here, a new track was added
										if($('#videoright audio').length === 0 && $('#videoright video').length === 0) {
											$('#videos').removeClass('hide');
											$('#videoright').parent().find('span').html(
												'Send DTMF: <span id="dtmf" class="btn-group btn-group-xs"></span>' +
												'<span id="ctrls" class="top-right btn-group btn-group-xs">' +
													'<button id="msg" title="Send message" class="btn btn-info"><i class="fa-solid fa-envelope"></i></button>' +
													'<button id="info" title="Send INFO" class="btn btn-info"><i class="fa-solid fa-info"></i></button>' +
													'<button id="transfer" title="Transfer call" class="btn btn-info"><i class="fa-solid fa-share"></i></button>' +
												'</span>');
											for(let i=0; i<12; i++) {
												if(i<10)
													$('#dtmf').append('<button class="btn btn-info dtmf">' + i + '</button>');
												else if(i == 10)
													$('#dtmf').append('<button class="btn btn-info dtmf">#</button>');
												else if(i == 11)
													$('#dtmf').append('<button class="btn btn-info dtmf">*</button>');
											}
											$('#dtmf .dtmf').click(function() {
												// Send DTMF tone (inband)
												sipcall.dtmf({dtmf: { tones: $(this).text()}});
												// Notice you can also send DTMF tones using SIP INFO
												// 		sipcall.send({message: {request: "dtmf_info", digit: $(this).text()}});
											});
											$('#msg').click(function() {
												bootbox.prompt("Insert message to send", function(result) {
													if(result && result !== '') {
														// Send the message
														let msg = { request: "message", content: result };
														sipcall.send({ message: msg });
													}
												});
											});
											/*
											$('#info').click(function() {
												bootbox.dialog({
													message: 'Type: <input class="form-control" type="text" id="type" placeholder="e.g., application/xml">' +
														'<br/>Content: <input class="form-control" type="text" id="content" placeholder="e.g., <message>hi</message>">',
													title: "Insert the type and content to send",
													buttons: {
														cancel: {
															label: "Cancel",
															className: "btn-secondary",
															callback: function() {
																// Do nothing
															}
														},
														ok: {
															label: "OK",
															className: "btn-primary",
															callback: function() {
																// Send the INFO
																let type = $('#type').val();
																let content = $('#content').val();
																if(type === '' || content === '')
																	return;
																let msg = { request: "info", type: type, content: content };
																sipcall.send({ message: msg });
															}
														}
													}
												});
											});
											$('#transfer').click(function() {
												bootbox.dialog({
													message: '<input class="form-control" type="text" id="transferto" placeholder="e.g., sip:goofy@example.com">',
													title: "Insert the address to transfer the call to",
													buttons: {
														cancel: {
															label: "Cancel",
															className: "btn-secondary",
															callback: function() {
																// Do nothing
															}
														},
														blind: {
															label: "Blind transfer",
															className: "btn-info",
															callback: function() {
																// Start a blind transfer
																let address = $('#transferto').val();
																if(address === '')
																	return;
																let msg = { request: "transfer", uri: address };
																sipcall.send({ message: msg });
															}
														},
														attended: {
															label: "Attended transfer",
															className: "btn-primary",
															callback: function() {
																// Start an attended transfer
																let address = $('#transferto').val();
																if(address === '')
																	return;
																// Add the call-id to replace to the transfer
																let msg = { request: "transfer", uri: address, replace: sipcall.callId };
																sipcall.send({ message: msg });
															}
														}
													}
												});
											});
	*/
										}
										if(track.kind === "audio") {
											// New audio track: create a stream out of it, and use a hidden <audio> element
											let stream = new MediaStream([track]);
											remoteTracks[mid] = stream;
											Janus.log("Created remote audio stream:", stream);
											$('#videoright').append('<audio class="hide" id="peervideom' + mid + '" autoplay playsinline/>');
											Janus.attachMediaStream($('#peervideom' + mid).get(0), stream);
											if(remoteVideos === 0) {
												// // No video, at least for now: show a placeholder
												// if($('#videoright .no-video-container').length === 0) {
												// 	$('#videoright').append(
												// 		'<div class="no-video-container">' +
												// 			'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
												// 			'<span class="no-video-text">No remote video available</span>' +
												// 		'</div>');
												// }
											}
										} else {
											// // New video track: create a stream out of it
											// remoteVideos++;
											// $('#videoright .no-video-container').remove();
											// let stream = new MediaStream([track]);
											// remoteTracks[mid] = stream;
											// Janus.log("Created remote video stream:", stream);
											// $('#videoright').append('<video class="rounded centered" id="peervideom' + mid + '" width="100%" height="100%" autoplay playsinline/>');
											// Janus.attachMediaStream($('#peervideom' + mid).get(0), stream);
										}
									},
									oncleanup: function() {
										Janus.log(" ::: Got a cleanup notification :::");
										$("#videoleft").empty().parent().unblock();
										$('#videoright').empty();
										$('#videos').addClass('hide');
										$('#dtmf').parent().html("Remote UA");
										if(sipcall) {
											delete sipcall.callId;
											delete sipcall.doAudio;
											//delete sipcall.doVideo;
										}
										localTracks = {};
										localVideos = 0;
										remoteTracks = {};
										remoteVideos = 0;
									}
								});
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
		//});
	}});
});

function updateStreamsList() {
	$('#update-streams').unbind('click').addClass('fa-spin');
	let body = { request: "list" };
	Janus.debug("Sending message:", body);
	streaming.send({ message: body, success: function(result) {
		setTimeout(function() {
			$('#update-streams').removeClass('fa-spin').unbind('click').click(updateStreamsList);
		}, 500);
		if(!result) {
			bootbox.alert("Got no response to our query for available streams");
			return;
		}
		if(result["list"]) {
			$('#streams').removeClass('hide');
			$('#streamslist').empty();
			$('#watch').attr('disabled', true).unbind('click');
			let list = result["list"];
			if(list && Array.isArray(list)) {
				list.sort(function(a, b) {
					if(!a || a.id < (b ? b.id : 0))
						return -1;
					if(!b || b.id < (a ? a.id : 0))
						return 1;
					return 0;
				});
			}
			Janus.log("Got a list of available streams:", list);
			streamsList = {};
			for(let mp in list) {
				Janus.debug("  >> [" + list[mp]["id"] + "] " + list[mp]["description"] + " (" + list[mp]["type"] + ")");
				$('#streamslist').append("<a class='dropdown-item' href='#' id='" + list[mp]["id"] + "'>" + escapeXmlTags(list[mp]["description"]) + " (" + list[mp]["type"] + ")" + "</a>");
				// Check the nature of the available streams, and if there are some multistream ones
				list[mp].legacy = true;
				if(list[mp].media) {
					let audios = 0, videos = 0;
					for(let mi in list[mp].media) {
						if(!list[mp].media[mi])
							continue;
						if(list[mp].media[mi].type === "audio")
							audios++;
						else if(list[mp].media[mi].type === "video")
							videos++;
						if(audios > 1 || videos > 1) {
							list[mp].legacy = false;
							break;
						}
					}
				}
				// Keep track of all the available streams
				streamsList[list[mp]["id"]] = list[mp];
			}
			$('#streamslist a').unbind('click').click(function() {
				$('.dropdown-toggle').dropdown('hide');
				selectedStream = $(this).attr("id");
				$('#streamset').html($(this).html()).parent().removeClass('open');
				$('#list .dropdown-backdrop').remove();
				return false;

			});
			$('#watch').removeAttr('disabled').unbind('click').click(startStream);
		}
	}});
}

function getStreamInfo() {
	$('#metadata').empty();
	$('#info').addClass('hide');
	if(!selectedStream || !streamsList[selectedStream])
		return;
	// Send a request for more info on the mountpoint we subscribed to
	let body = { request: "info", id: parseInt(selectedStream) || selectedStream };
	streaming.send({ message: body, success: function(result) {
		if(result && result.info && result.info.metadata) {
			$('#metadata').html(escapeXmlTags(result.info.metadata));
			$('#info').removeClass('hide');
		}
	}});
}

function startStream() {
	Janus.log("Selected video id #" + selectedStream);
	if(!selectedStream || !streamsList[selectedStream]) {
		bootbox.alert("Select a stream from the list");
		return;
	}
	$('#streamset').attr('disabled', true);
	$('#streamslist').attr('disabled', true);
	$('#watch').attr('disabled', true).unbind('click');
	// Add some panels to host the remote streams
	if(streamsList[selectedStream].legacy) {
		// At max 1-audio/1-video, so use a single panel
		let mid = null;
		for(let mi in streamsList[selectedStream].media) {
			// Add a new panel
			let type = streamsList[selectedStream].media[mi].type;
			if(type === "video") {
				mid = streamsList[selectedStream].media[mi].mid;
				break;
			}
		}
		if($('#mstream0').length === 0) {
			addPanel("0", (mid ? mid : "0"));
			// No remote video yet
			$('#mstream0').append('<video class="rounded centered waitingvideo" id="waitingvideo0" width="100%" height="100%" />');
		}
		dataMid = "0";
	} else {
		// Multistream mountpoint, create a panel for each stream
		for(let mi in streamsList[selectedStream].media) {
			// Add a new panel
			let type = streamsList[selectedStream].media[mi].type;
			let mid = streamsList[selectedStream].media[mi].mid;
			let label = streamsList[selectedStream].media[mi].label;
			if($('#mstream'+mid).length === 0) {
				addPanel(mid, mid, label);
				// No remote media yet
				$('#mstream'+mid).append('<video class="rounded centered waitingvideo" id="waitingvideo'+mid+'" width="100%" height="100%" />');
			}
			if(type === 'data')
				dataMid = mid;
		}
	}
	// Prepare the request to start streaming and send it
	let body = { request: "watch", id: parseInt(selectedStream) || selectedStream };
	// Notice that, for RTP mountpoints, you can subscribe to a subset
	// of the mountpoint media, rather than them all, by adding a "stream"
	// array containing the list of stream mids you're interested in, e.g.:
	//
	//		body.streams = [ "0", "2" ];
	//
	// to only subscribe to the first and third stream, and skip the second
	// (assuming those are the mids you got from a "list" or "info" request).
	// By default, you always subscribe to all the streams in a mountpoint
	streaming.send({ message: body });
	// Get some more info for the mountpoint to display, if any
	getStreamInfo();
	registerUsername();
}

function stopStream() {
	$('#watch').attr('disabled', true).unbind('click');
	let body = { request: "stop" };
	streaming.send({ message: body });
	streaming.hangup();
}

// Helper to escape XML tags
function escapeXmlTags(value) {
	if(value) {
		let escapedValue = value.replace(new RegExp('<', 'g'), '&lt');
		escapedValue = escapedValue.replace(new RegExp('>', 'g'), '&gt');
		return escapedValue;
	}
}

// Helper to add a new panel to the 'videos' div
function addPanel(panelId, mid, desc) {
	$('#videos').append(
		'<div class="row mb-3" id="panel' + panelId + '">' +
		'	<div class="card w-100">' +
		'		<div class="card-header">' +
		'			<span class="card-title">' + (desc ? desc : "Stream") +
		'				<span class="badge bg-info hide" id="status' + mid + '"></span>' +
		'				<span class="badge bg-primary hide" id="curres' + mid + '"></span>' +
		'				<span class="badge bg-info hide" id="curbitrate' + mid + '"></span>' +
		'			</span>' +
		'		</div>' +
		'		<div class="card-body" id="mstream' + panelId + '">' +
		'			<div class="text-center">' +
		'				<div id="spinner' + mid + '" class="spinner-border" role="status">' +
		'					<span class="visually-hidden">Loading...</span>' +
		'				</div>' +
		'			</div>' +
		'		</div>' +
		'	</div>' +
		'</div>'
	);
}

// Helpers to create Simulcast-related UI, if enabled
function addSimulcastButtons(mid) {
	$('#curres'+mid).parent().append(
		'<div id="simulcast'+mid+'" class="btn-group-vertical btn-group-xs top-right">' +
		'	<div class="btn-group btn-group-xs d-flex" style="width: 100%">' +
		'		<button id="m-'+mid+'-sl-2" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Switch to higher quality">SL 2</button>' +
		'		<button id="m-'+mid+'-sl-1" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Switch to normal quality">SL 1</button>' +
		'		<button id="m-'+mid+'-sl-0" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Switch to lower quality">SL 0</button>' +
		'	</div>' +
		'	<div class="btn-group btn-group-xs d-flex hide" style="width: 100%">' +
		'		<button id="m-'+mid+'-tl-2" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 2">TL 2</button>' +
		'		<button id="m-'+mid+'-tl-1" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 1">TL 1</button>' +
		'		<button id="m-'+mid+'-tl-0" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 0">TL 0</button>' +
		'	</div>' +
		'</div>');
	// Enable the simulcast selection buttons
	$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Switching simulcast substream, wait for it... (lower quality)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-sl-2').hasClass('btn-success'))
				$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-sl-1').hasClass('btn-success'))
				$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			streaming.send({ message: { request: "configure", mid: mid, substream: 0 }});
		});
	$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Switching simulcast substream, wait for it... (normal quality)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-sl-2').hasClass('btn-success'))
				$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			if(!$('#m-'+mid+'-sl-0').hasClass('btn-success'))
				$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, substream: 1 }});
		});
	$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Switching simulcast substream, wait for it... (higher quality)", null, {timeOut: 2000});
			$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			if(!$('#m-'+mid+'-sl-1').hasClass('btn-success'))
				$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-sl-0').hasClass('btn-success'))
				$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, substream: 2 }});
		});
	// We always add temporal layer buttons too, even though these will only work with vP8
	$('#m-'+mid+'-tl-0').parent().removeClass('hide');
	$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping simulcast temporal layer, wait for it... (lowest FPS)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-tl-2').hasClass('btn-success'))
				$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-tl-1').hasClass('btn-success'))
				$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			streaming.send({ message: { request: "configure", mid: mid, temporal: 0 }});
		});
	$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping simulcast temporal layer, wait for it... (medium FPS)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-tl-2').hasClass('btn-success'))
				$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-info');
			if(!$('#m-'+mid+'-tl-0').hasClass('btn-success'))
				$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, temporal: 1 }});
		});
	$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping simulcast temporal layer, wait for it... (highest FPS)", null, {timeOut: 2000});
			$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			if(!$('#m-'+mid+'-tl-1').hasClass('btn-success'))
				$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-tl-0').hasClass('btn-success'))
				$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, temporal: 2 }});
		});
}

function updateSimulcastButtons(mid, substream, temporal) {
	// Check the substream
	if(substream === 0) {
		toastr.success("Switched simulcast substream! (lower quality)", null, {timeOut: 2000});
		$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
	} else if(substream === 1) {
		toastr.success("Switched simulcast substream! (normal quality)", null, {timeOut: 2000});
		$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	} else if(substream === 2) {
		toastr.success("Switched simulcast substream! (higher quality)", null, {timeOut: 2000});
		$('#m-'+mid+'-sl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	}
	// Check the temporal layer
	if(temporal === 0) {
		toastr.success("Capped simulcast temporal layer! (lowest FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
	} else if(temporal === 1) {
		toastr.success("Capped simulcast temporal layer! (medium FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	} else if(temporal === 2) {
		toastr.success("Capped simulcast temporal layer! (highest FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	}
}

// Helpers to create SVC-related UI for a new viewer
function addSvcButtons(mid) {
	if($('#svc').length > 0)
		return;
	$('#curres'+mid).parent().append(
		'<div id="svc'+mid+'" class="btn-group-vertical btn-group-vertical-xs top-right">' +
		'	<div class"row">' +
		'		<div class="btn-group btn-group-xs d-flex" style="width: 100%">' +
		'			<button id="m-'+mid+'-sl-1" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Switch to normal resolution">SL 1</button>' +
		'			<button id="m-'+mid+'-sl-0" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Switch to low resolution">SL 0</button>' +
		'		</div>' +
		'	</div>' +
		'	<div class"row">' +
		'		<div class="btn-group btn-group-xs d-flex" style="width: 100%">' +
		'			<button id="m-'+mid+'-tl-2" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 2 (high FPS)">TL 2</button>' +
		'			<button id="m-'+mid+'-tl-1" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 1 (medium FPS)">TL 1</button>' +
		'			<button id="m-'+mid+'-tl-0" type="button" class="btn btn-primary" data-bs-toggle="tooltip" title="Cap to temporal layer 0 (low FPS)">TL 0</button>' +
		'		</div>' +
		'	</div>' +
		'</div>'
	);
	// Enable the SVC selection buttons
	$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Switching SVC spatial layer, wait for it... (low resolution)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-sl-1').hasClass('btn-success'))
				$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			streaming.send({ message: { request: "configure", mid: mid, spatial_layer: 0 }});
		});
	$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Switching SVC spatial layer, wait for it... (normal resolution)", null, {timeOut: 2000});
			$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			if(!$('#m-'+mid+'-sl-0').hasClass('btn-success'))
				$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, spatial_layer: 1 }});
		});
	$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping SVC temporal layer, wait for it... (lowest FPS)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-tl-2').hasClass('btn-success'))
				$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-tl-1').hasClass('btn-success'))
				$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			streaming.send({ message: { request: "configure", mid: mid, temporal_layer: 0 }});
		});
	$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping SVC temporal layer, wait for it... (medium FPS)", null, {timeOut: 2000});
			if(!$('#m-'+mid+'-tl-2').hasClass('btn-success'))
				$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info').addClass('btn-primary');
			$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-info');
			if(!$('#m-'+mid+'-tl-0').hasClass('btn-success'))
				$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, temporal_layer: 1 }});
		});
	$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary')
		.unbind('click').click(function() {
			toastr.info("Capping SVC temporal layer, wait for it... (highest FPS)", null, {timeOut: 2000});
			$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
			if(!$('#m-'+mid+'-tl-1').hasClass('btn-success'))
				$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info').addClass('btn-primary');
			if(!$('#m-'+mid+'-tl-0').hasClass('btn-success'))
				$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info').addClass('btn-primary');
			streaming.send({ message: { request: "configure", mid: mid, temporal_layer: 2 }});
		});
}

function updateSvcButtons(mid, spatial, temporal) {
	// Check the spatial layer
	if(spatial === 0) {
		toastr.success("Switched SVC spatial layer! (lower resolution)", null, {timeOut: 2000});
		$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
	} else if(spatial === 1) {
		toastr.success("Switched SVC spatial layer! (normal resolution)", null, {timeOut: 2000});
		$('#m-'+mid+'-sl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-sl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	}
	// Check the temporal layer
	if(temporal === 0) {
		toastr.success("Capped SVC temporal layer! (lowest FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
	} else if(temporal === 1) {
		toastr.success("Capped SVC temporal layer! (medium FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	} else if(temporal === 2) {
		toastr.success("Capped SVC temporal layer! (highest FPS)", null, {timeOut: 2000});
		$('#m-'+mid+'-tl-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
		$('#m-'+mid+'-tl-1').removeClass('btn-primary btn-success').addClass('btn-primary');
		$('#m-'+mid+'-tl-0').removeClass('btn-primary btn-success').addClass('btn-primary');
	}
}
function checkEnter(field, event) {
	let theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		if(field.id == 'server' || field.id == 'username' || field.id == 'password' || field.id == 'displayname')
			registerUsername();
		else if(field.id == 'peer')
			doCall();
		return false;
	} else {
		return true;
	}
}
function registerUsername() {
	// simple register
	let register = {
		request: "register",
		username: "sip:6004@87.242.100.34",
		authuser: "6004",
		display_name: "Panel N 6004",
		proxy: "sip:87.242.100.34:5060",
		secret: "6004"
	};
	//register["proxy"] = "sip:iot.leo4.ru:5060";
	//register["secret"] = "6002";
	sipcall.send({ message: register });
}

function doCall(ev) {
	// Call someone (from the main session or one of the helpers)
	let button = ev ? ev.currentTarget.id : "call";
	let helperId = null; //button.split("call")[1];
	// if(helperId === "")
	// 	helperId = null;
	// else
	// 	helperId = parseInt(helperId);
	
	let handle = sipcall; //helperId ? helpers[helperId].sipcall : sipcall;
	let prefix = ""; //helperId ? ("[Helper #" + helperId + "]") : "";
	let suffix = ""; //helperId ? (""+helperId) : "";
	$('#peer' + suffix).attr('disabled', true);
	$('#call' + suffix).attr('disabled', true).unbind('click');
	//$('#dovideo' + suffix).attr('disabled', true);
	let username = $('#peer' + suffix).val();
	if(username === "") {
		bootbox.alert('Please insert a valid SIP address (e.g., sip:pluto@example.com)');
		$('#peer' + suffix).removeAttr('disabled');
		//$('#dovideo' + suffix).removeAttr('disabled');
		$('#call' + suffix).removeAttr('disabled').click(function(ev) { doCall(ev); });
		return;
	}
	if(username.indexOf("sip:") != 0 || username.indexOf("@") < 0) {
		bootbox.alert('Please insert a valid SIP address (e.g., sip:pluto@example.com)');
		$('#peer' + suffix).removeAttr('disabled').val("");
		//$('#dovideo' + suffix).removeAttr('disabled').val("");
		$('#call' + suffix).removeAttr('disabled').click(function(ev) { doCall(ev); });
		return;
	}
	// Call this URI
	//let doVideo = $('#dovideo' + suffix).is(':checked');
	Janus.log(prefix + "This is a SIP call"); // + (doVideo ? "video" : "audio") + " call (dovideo=" + doVideo + ")");
	actuallyDoCall(handle, $('#peer' + suffix).val()); //, doVideo);
}
function actuallyDoCall(handle, uri, referId) {
	// We want bidirectional audio for sure, and maybe video
	handle.doAudio = true;
	//handle.doVideo = doVideo;
	let tracks = [{ type: 'audio', capture: true, recv: true }];
	// if(doVideo)
	// 	tracks.push({ type: 'video', capture: true, recv: true });
	handle.createOffer(
		{
			tracks: tracks,
			success: function(jsep) {
				Janus.debug("Got SDP!", jsep);
				// By default, you only pass the SIP URI to call as an
				// argument to a "call" request. Should you want the
				// SIP stack to add some custom headers to the INVITE,
				// you can do so by adding an additional "headers" object,
				// containing each of the headers as key-value, e.g.:
				//		let body = { request: "call", uri: $('#peer').val(),
				//			headers: {
				//				"My-Header": "value",
				//				"AnotherHeader": "another string"
				//			}
				//		};
				let body = { request: "call", uri: uri };
				// Note: you can also ask the plugin to negotiate SDES-SRTP, instead of the
				// default plain RTP, by adding a "srtp" attribute to the request. Valid
				// values are "sdes_optional" and "sdes_mandatory", e.g.:
				//		let body = { request: "call", uri: $('#peer').val(), srtp: "sdes_optional" };
				// "sdes_optional" will negotiate RTP/AVP and add a crypto line,
				// "sdes_mandatory" will set the protocol to RTP/SAVP instead.
				// Just beware that some endpoints will NOT accept an INVITE
				// with a crypto line in it if the protocol is not RTP/SAVP,
				// so if you want SDES use "sdes_optional" with care.
				// Note 2: by default, the SIP plugin auto-answers incoming
				// re-INVITEs, without involving the browser/client: this is
				// for backwards compatibility with older Janus clients that
				// may not be able to handle them. Since we want to receive
				// re-INVITES to handle them ourselves, we specify it here:
				body["autoaccept_reinvites"] = false;
				// if(referId) {
				// 	// In case we're originating this call because of a call
				// 	// transfer, we need to provide the internal reference ID
				// 	body["refer_id"] = referId;
				// }
				handle.send({ message: body, jsep: jsep });
			},
			error: function(error) {
				Janus.error("WebRTC error...", error);
				bootbox.alert("WebRTC error... " + error.message);
			}
		});
}

function doHangup(ev) {
	// Hangup a call (on the main session or one of the helpers)
	let button = ev ? ev.currentTarget.id : "call";
	let helperId = button.split("call")[1];
	if(helperId === "")
		helperId = null;
	else
		helperId = parseInt(helperId);
	if(!helperId) {
		$('#call').attr('disabled', true).unbind('click');
		let hangup = { request: "hangup" };
		sipcall.send({ message: hangup });
		sipcall.hangup();
	} else {
		$('#call' + helperId).attr('disabled', true).unbind('click');
		let hangup = { request: "hangup" };
		helpers[helperId].sipcall.send({ message: hangup });
		helpers[helperId].sipcall.hangup();
	}
}
